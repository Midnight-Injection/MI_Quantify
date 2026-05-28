import { computed, defineComponent, onActivated, onDeactivated, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { openUrl } from '@tauri-apps/plugin-opener'
import { useAiInsights } from '@/composables/useAiInsights'
import { useAiTaskLogger } from '@/composables/useAiTaskLogger'
import { useRealtimeTask } from '@/composables/useRealtimeTask'
import { useMarketStore } from '@/stores/market'
import { useSettingsStore } from '@/stores/settings'
import type { AiInsightDigest, FundFlow, HomeMetricCard, NewsItem, StockListItem } from '@/types'
import { formatAmount, formatPercent, formatPrice, formatTurnoverPulse } from '@/utils/format'
import { getMarketSessionContext } from '@/utils/marketSession'
import { useHomeWorkbench } from './useHomeWorkbench'
import HomeAiTab from './components/HomeAiTab.vue'

type MarketType = 'a' | 'hk' | 'us'

interface StockDrilldownState {
  info: Record<string, any>
  finance: Record<string, any>
  fundflow: Array<Record<string, any>>
  news: NewsItem[]
}

function diffCalendarDays(startDate: string, endDate: string) {
  const start = new Date(`${startDate}T00:00:00Z`).getTime()
  const end = new Date(`${endDate}T00:00:00Z`).getTime()
  return Math.round((end - start) / (24 * 60 * 60 * 1000))
}

function getWeekday(timezone: string) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
  }).format(new Date())
}

/**
 * 根据交易时段解析 AI 摘要标题
 * @param market - 市场类型
 * @returns 对应时段的标题文本
 */
function resolveAiDigestTitle(market: MarketType) {
  const session = getMarketSessionContext(market)
  const weekday = getWeekday(session.timezone)
  const [hourText = '0', minuteText = '0'] = session.currentTime.split(':')
  const minutes = Number(hourText) * 60 + Number(minuteText)
  const daysToNextOpen = diffCalendarDays(session.currentDate, session.nextOpenDate)
  const nextWeekTitle = weekday === 'Sat'
    || weekday === 'Sun'
    || ((session.phase === 'post_market' || session.phase === 'holiday_closed') && (weekday === 'Fri' || daysToNextOpen >= 3))

  if (session.phase === 'holiday_closed' || session.phase === 'post_market') {
    return nextWeekTitle ? '下周炒什么' : '明天炒什么'
  }
  if (session.phase === 'midday_break') return '下午炒什么'
  if (session.phase === 'trading') return minutes < 690 ? '早盘炒什么' : '下午炒什么'
  return '早盘炒什么'
}

export default defineComponent({
  name: 'HomeView',
  components: {
    HomeAiTab,
  },
  setup() {
    const router = useRouter()
    const marketStore = useMarketStore()
    const settingsStore = useSettingsStore()
    const { generateDigest } = useAiInsights()
    const aiTaskLogger = useAiTaskLogger()
    const { tabs, refreshAll, isInitialLoading } = useHomeWorkbench()
    const currentMarket = ref<MarketType>('a')
    const aiDigest = ref<AiInsightDigest | null>(null)
    const aiDigestError = ref('')
    const aiDigestLoading = ref(false)
    const lastDigestAt = ref(0)

    const marketTabs = [
      { value: 'a' as MarketType, label: 'A股' },
      { value: 'hk' as MarketType, label: '港股' },
      { value: 'us' as MarketType, label: '美股' },
    ]

    const watchlistQuotes = computed(() =>
      marketStore.watchList.flatMap((item) => {
        const quote = marketStore.quotes.get(item.code)
        return quote ? [{ ...item, quote }] : []
      }),
    )
    const overviewData = computed(() => tabs.overview.data)
    const fundflowData = computed(() => tabs.fundflow.data)
    const sectorData = computed(() => tabs.sector.data)
    const stocksData = computed(() => tabs.stocks.data)
    const newsData = computed(() => tabs.news.data)
    const aiContext = computed(() => tabs.ai.data)
    const visibleIndices = computed(() => overviewData.value?.indices || [])
    const pulseCards = computed(() => overviewData.value?.summaryCards.slice(0, 4) || [])
    const isTradingSession = computed(() => getMarketSessionContext(currentMarket.value).phase === 'trading')
    const marketMood = computed(() => {
      const breadth = overviewData.value?.breadth
      const positiveRatio = breadth?.positiveRatio || 0
      if (positiveRatio >= 58) return 'risk-on'
      if (positiveRatio <= 44) return 'risk-off'
      return 'balanced'
    })
    const heroRealtimeActive = computed(() => polling.isRunning.value && isTradingSession.value)

    /**
     * 新闻列表（取最新 15 条）
     */
    const newsItems = computed<NewsItem[]>(() => {
      const latest = newsData.value?.latest || []
      return latest.slice(0, 15)
    })

    /**
     * 热门板块排行（行业板块 TOP 15）
     */
    const sectorRankItems = computed(() => sectorData.value?.industry?.slice(0, 15) || [])

    /**
     * 个股资金流入 TOP 8
     */
    const fundflowInflowItems = computed(() => fundflowData.value?.stockFlows?.inflow?.slice(0, 8) || [])

    /**
     * 个股资金流出 TOP 8
     */
    const fundflowOutflowItems = computed(() => fundflowData.value?.stockFlows?.outflow?.slice(0, 8) || [])

    /**
     * 涨幅榜 TOP 8
     */
    const leaderItems = computed(() => stocksData.value?.boards?.leaders?.slice(0, 8) || [])

    /**
     * 跌幅榜 TOP 8
     */
    const loserItems = computed(() => stocksData.value?.boards?.losers?.slice(0, 8) || [])

    /**
     * 排行榜是否有可用数据
     */
    const hasRankingsData = computed(() =>
      sectorRankItems.value.length > 0
      || fundflowInflowItems.value.length > 0
      || leaderItems.value.length > 0,
    )

    function isFundFlowItem(item: FundFlow | StockListItem): item is FundFlow {
      return 'mainNetInflow' in item
    }

    async function loadWatchlistQuotes() {
      const codes = marketStore.watchList.map((item) => item.code)
      if (!codes.length) return
      await marketStore.fetchQuotes(codes)
    }

    async function refreshHome(nextMarket = currentMarket.value) {
      currentMarket.value = nextMarket
      await refreshAll(nextMarket)
      await loadWatchlistQuotes()
    }

    function switchMarket(market: MarketType) {
      currentMarket.value = market
      aiDigest.value = null
      aiDigestError.value = ''
      void refreshHome(market)
    }

    function navigateToStock(code: string) {
      if (!code) return
      router.push({ name: 'stockDetail', params: { code } })
    }

    /**
     * 新闻卡片点击处理：有 url 时打开浏览器，有关联股票时跳转详情
     */
    function handleNewsClick(item: NewsItem) {
      if (item.url) {
        void openUrl(item.url)
        return
      }
      if (item.relatedStocks?.length) {
        navigateToStock(item.relatedStocks[0])
      }
    }

    function isTurnoverPulseCard(card: HomeMetricCard) {
      return card.label === '成交脉冲'
    }

    let homeAiTaskId: string | null = null

    function cancelHomeAiDigest() {
      if (!homeAiTaskId) return
      aiTaskLogger.cancelTask(homeAiTaskId)
      homeAiTaskId = null
      aiDigestLoading.value = false
    }

    async function requestDigest(force = false) {
      if (!force) return
      if (aiDigestLoading.value) return
      lastDigestAt.value = Date.now()

      if (!settingsStore.isAiProviderConfigured(settingsStore.activeProvider)) {
        aiDigestError.value = '当前未配置 AI 模型，无法生成首页市场点评。'
        return
      }

      const task = aiTaskLogger.createTask('AI市场点评', 'home')
      homeAiTaskId = task.id
      aiDigestLoading.value = true
      aiDigestError.value = ''
      try {
        const marketSession = getMarketSessionContext(currentMarket.value)
        const watchlistCodes = marketStore.watchList.map((item) => item.code)
        aiDigest.value = await generateDigest(settingsStore.activeProvider, null, {
          title: resolveAiDigestTitle(currentMarket.value),
          market: currentMarket.value,
          currentTime: new Date().toLocaleString('zh-CN', { timeZone: marketSession.timezone, hour12: false }),
          watchlistCodes,
          abortSignal: task.abortController?.signal,
          onProgress: (step) => aiTaskLogger.addProgressLog(task.id, step),
        })
        aiTaskLogger.completeTask(task.id, true)
      } catch (error) {
        if (!aiTaskLogger.isTaskCancelled(task.id)) {
          const message = error instanceof Error ? error.message : String(error)
          aiDigestError.value = message
          aiTaskLogger.completeTask(task.id, false, message)
        }
      } finally {
        aiDigestLoading.value = false
        homeAiTaskId = null
      }
    }

    const polling = useRealtimeTask(async () => {
      await refreshHome(currentMarket.value)
    }, {
      intervalMultiplier: 1,
      immediate: false,
      minimumMs: 30000,
      pauseWhenHidden: true,
      market: () => currentMarket.value,
      skipWhenMarketClosed: true,
    })

    onMounted(async () => {
      await refreshHome(currentMarket.value)
      polling.start(false)
    })

    onActivated(() => {
      void refreshHome(currentMarket.value)
      polling.start(false)
    })

    onDeactivated(() => {
      polling.stop()
    })

    return {
      currentMarket,
      marketTabs,
      tabs,
      pulseCards,
      visibleIndices,
      newsItems,
      sectorRankItems,
      fundflowInflowItems,
      fundflowOutflowItems,
      leaderItems,
      loserItems,
      hasRankingsData,
      isFundFlowItem,
      aiDigest,
      aiDigestError,
      aiDigestLoading,
      aiContext,
      marketMood,
      heroRealtimeActive,
      isInitialLoading,
      formatPrice,
      formatPercent,
      formatAmount,
      formatTurnoverPulse,
      isTurnoverPulseCard,
      switchMarket,
      navigateToStock,
      handleNewsClick,
      requestDigest,
      cancelHomeAiDigest,
    }
  },
})
