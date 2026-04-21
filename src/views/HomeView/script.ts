import { computed, defineComponent, onActivated, onDeactivated, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useSidecar } from '@/composables/useSidecar'
import { useAiInsights } from '@/composables/useAiInsights'
import { useAiTaskLogger } from '@/composables/useAiTaskLogger'
import { useRealtimeTask } from '@/composables/useRealtimeTask'
import { useMarketStore } from '@/stores/market'
import { useSettingsStore } from '@/stores/settings'
import type { AiInsightDigest, HomeMetricCard, NewsItem, StockListItem } from '@/types'
import { formatAmount, formatPercent, formatPrice, formatTurnoverPulse } from '@/utils/format'
import { getMarketSessionContext } from '@/utils/marketSession'
import { useHomeWorkbench } from './useHomeWorkbench'
import HomeAiTab from './components/HomeAiTab.vue'
import HomeOverviewTab from './components/HomeOverviewTab.vue'
import HomeFundflowTab from './components/HomeFundflowTab.vue'
import HomeSectorTab from './components/HomeSectorTab.vue'
import HomeStocksTab from './components/HomeStocksTab.vue'
import HomeNewsTab from './components/HomeNewsTab.vue'

type MarketType = 'a' | 'hk' | 'us'
type HomeTabKey = 'ai' | 'overview' | 'fundflow' | 'sector' | 'stocks' | 'news'

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
  if (session.phase === 'trading') return minutes < 12 * 60 ? '早上炒什么' : '下午炒什么'
  return '早上炒什么'
}

function uniqueCodes(codes: string[]) {
  return [...new Set(codes.map((item) => `${item || ''}`.trim()).filter(Boolean))]
}

export default defineComponent({
  name: 'HomeView',
  components: {
    HomeAiTab,
    HomeOverviewTab,
    HomeFundflowTab,
    HomeSectorTab,
    HomeStocksTab,
    HomeNewsTab,
  },
  setup() {
    const router = useRouter()
    const { get } = useSidecar()
    const marketStore = useMarketStore()
    const settingsStore = useSettingsStore()
    const { generateDigest } = useAiInsights()
    const aiTaskLogger = useAiTaskLogger()
    const { tabs, refreshAll, isInitialLoading } = useHomeWorkbench()
    const currentMarket = ref<MarketType>('a')
    const activeTab = ref<HomeTabKey>('overview')
    const aiDigest = ref<AiInsightDigest | null>(null)
    const aiDigestError = ref('')
    const aiDigestLoading = ref(false)
    const selectedSectorCode = ref('')
    const selectedStockCode = ref('')
    const sectorMembers = ref<StockListItem[]>([])
    const sectorMembersLoading = ref(false)
    const stockDetail = ref<StockDrilldownState | null>(null)
    const stockDetailLoading = ref(false)
    const lastDigestAt = ref(0)

    const marketTabs = [
      { value: 'a' as MarketType, label: 'A股' },
      { value: 'hk' as MarketType, label: '港股' },
      { value: 'us' as MarketType, label: '美股' },
    ]
    const homeTabs = [
      { key: 'overview' as HomeTabKey, label: '盘面总览' },
      { key: 'fundflow' as HomeTabKey, label: '资金方向' },
      { key: 'sector' as HomeTabKey, label: '热门板块' },
      { key: 'stocks' as HomeTabKey, label: '热点个股' },
      { key: 'news' as HomeTabKey, label: '新闻脉冲' },
      { key: 'ai' as HomeTabKey, label: 'AI评估' },
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
    const currentBreadthSourceLabel = computed(() => overviewData.value?.breadth.sourceLabel || '')
    const homeDigestAutoEnabled = computed(() => settingsStore.settings.ai.autoRun.homeDigest)
    const isTradingSession = computed(() => getMarketSessionContext(currentMarket.value).phase === 'trading')
    const marketMood = computed(() => {
      const breadth = overviewData.value?.breadth
      const positiveRatio = breadth?.positiveRatio || 0
      if (positiveRatio >= 58) return 'risk-on'
      if (positiveRatio <= 44) return 'risk-off'
      return 'balanced'
    })
    const heroRealtimeActive = computed(() => polling.isRunning.value && isTradingSession.value)

    async function loadWatchlistQuotes() {
      const codes = marketStore.watchList.map((item) => item.code)
      if (!codes.length) return
      await marketStore.fetchQuotes(codes)
    }

    async function loadSectorMembers(code: string) {
      if (!code) return
      sectorMembersLoading.value = true
      try {
        if (currentMarket.value === 'a') {
          const res = await get<{ data: StockListItem[] }>(`/api/sector/members?codes=${code}&pageSize=12`)
          sectorMembers.value = res.data || []
          return
        }
        const sector = sectorData.value?.leaders.find((item) => item.code === code)
        sectorMembers.value = sector?.members || []
      } catch (error) {
        console.error('Failed to load sector members:', error)
        sectorMembers.value = []
      } finally {
        sectorMembersLoading.value = false
      }
    }

    async function loadStockDetail(code: string) {
      if (!code) return
      stockDetailLoading.value = true
      try {
        const [profileRes, newsRes, fundflowRes] = await Promise.all([
          get<{ info: Record<string, any>; finance: Record<string, any> }>(`/api/market/stock/${code}/info`),
          get<{ data: NewsItem[] }>(`/api/market/stock/${code}/news`),
          currentMarket.value === 'a'
            ? get<{ data: Array<Record<string, any>> }>(`/api/fundflow/stock/${code}?days=5`)
            : Promise.resolve({ data: [] }),
        ])
        stockDetail.value = {
          info: profileRes.info || {},
          finance: profileRes.finance || {},
          fundflow: fundflowRes.data || [],
          news: newsRes.data || [],
        }
      } catch (error) {
        console.error('Failed to load stock detail:', error)
        stockDetail.value = null
      } finally {
        stockDetailLoading.value = false
      }
    }

    async function syncDrilldownSelections() {
      const focusSector = sectorData.value?.focusSector?.code || sectorData.value?.leaders[0]?.code || ''
      if (focusSector && !selectedSectorCode.value) {
        selectedSectorCode.value = focusSector
      }
      if (selectedSectorCode.value) {
        await loadSectorMembers(selectedSectorCode.value)
      }

      const focusStock = stocksData.value?.focusStock?.code || stocksData.value?.boards.active[0]?.code || ''
      if (focusStock && !selectedStockCode.value) {
        selectedStockCode.value = focusStock
      }
      if (selectedStockCode.value) {
        await loadStockDetail(selectedStockCode.value)
      }
    }

    async function refreshHome(nextMarket = currentMarket.value) {
      currentMarket.value = nextMarket
      await refreshAll(nextMarket)
      await loadWatchlistQuotes()
      await syncDrilldownSelections()
    }

    function switchMarket(market: MarketType) {
      currentMarket.value = market
      aiDigest.value = null
      aiDigestError.value = ''
      selectedSectorCode.value = ''
      selectedStockCode.value = ''
      sectorMembers.value = []
      stockDetail.value = null
      void refreshHome(market)
    }

    function navigateToStock(code: string) {
      if (!code) return
      router.push({ name: 'stockDetail', params: { code } })
    }

    function isTurnoverPulseCard(card: HomeMetricCard) {
      return card.label === '成交脉冲'
    }

    async function selectSector(code: string) {
      selectedSectorCode.value = code
      await loadSectorMembers(code)
    }

    async function selectStock(code: string) {
      selectedStockCode.value = code
      await loadStockDetail(code)
    }

    async function loadRecommendationCandidates() {
      const boardCandidates = stocksData.value?.boards.active.slice(0, 8).map((item) => item.code) || []
      const leaderCandidates = stocksData.value?.boards.leaders.slice(0, 6).map((item) => item.code) || []
      const watchCandidates = marketStore.watchList.slice(0, 6).map((item) => item.code)
      const codes = uniqueCodes([...boardCandidates, ...leaderCandidates, ...watchCandidates])
      if (codes.length < 6) {
        throw new Error(`实时推荐候选不足，当前仅 ${codes.length} 只，已禁止生成股票建议`)
      }

      await marketStore.fetchQuotes(codes)
      return codes.flatMap((code) => {
        const quote = marketStore.quotes.get(code)
        if (!quote?.timestamp) return []
        return [{
          code,
          name: quote.name || code,
          latestPrice: quote.price,
          changePercent: quote.changePercent,
          amount: quote.amount,
          turnover: quote.turnover || 0,
          source: 'hot' as const,
          quoteTimestamp: quote.timestamp,
          quoteAgeMs: Date.now() - quote.timestamp,
        }]
      })
    }

    let homeAiTaskId: string | null = null

    function cancelHomeAiDigest() {
      if (!homeAiTaskId) return
      aiTaskLogger.cancelTask(homeAiTaskId)
      homeAiTaskId = null
      aiDigestLoading.value = false
    }

    async function requestDigest(force = false) {
      if (!force && !homeDigestAutoEnabled.value) return
      if (aiDigestLoading.value) return
      const now = Date.now()
      if (!force && now - lastDigestAt.value < settingsStore.settings.ai.autoRunInterval * 1000) return
      lastDigestAt.value = now

      if (!settingsStore.isAiProviderConfigured(settingsStore.activeProvider)) {
        aiDigestError.value = '当前未配置 AI 模型，无法生成首页市场点评。'
        return
      }

      const task = aiTaskLogger.createTask('AI市场点评', 'home')
      homeAiTaskId = task.id
      aiDigestLoading.value = true
      aiDigestError.value = ''
      try {
        const recommendationCandidates = await loadRecommendationCandidates()
        const marketSession = getMarketSessionContext(currentMarket.value)
        aiDigest.value = await generateDigest(settingsStore.activeProvider, {
          title: resolveAiDigestTitle(currentMarket.value),
          market: currentMarket.value,
          currentTime: new Date().toLocaleString('zh-CN', { timeZone: marketSession.timezone, hour12: false }),
          snapshot: {
            marketLabel: marketSession.marketLabel,
            dataFreshness: {
              stockListUpdatedAt: stocksData.value?.updatedAt || 0,
              quotesUpdatedAt: marketStore.quotesUpdatedAt,
              newsUpdatedAt: newsData.value?.updatedAt || 0,
            },
            breadth: overviewData.value?.breadth,
            indices: (overviewData.value?.indices || []).slice(0, 5).map((item) => ({
              code: item.code,
              name: item.name,
              price: item.price,
              changePercent: item.changePercent,
              amount: item.amount,
            })),
            sectors: (sectorData.value?.leaders || []).slice(0, 8).map((item) => ({
              name: item.name,
              changePercent: item.changePercent,
              amount: item.amount || 0,
              leadingStock: item.leadingStock || '',
            })),
            hotStocks: (stocksData.value?.boards.active || []).slice(0, 12).map((item) => ({
              code: item.code,
              name: item.name,
              price: item.price,
              changePercent: item.changePercent,
              amount: item.amount,
              turnover: item.turnover || 0,
              sectorTags: item.sectorTags || [],
            })),
            fundFlows: (fundflowData.value?.stockFlows.inflow || []).slice(0, 8).map((item) => ({
              code: item.code,
              name: item.name,
              mainNetInflow: 'mainNetInflow' in item ? Number(item.mainNetInflow || 0) : Number(item.amount || 0),
              mainNetInflowPercent: 'mainNetInflowPercent' in item ? Number(item.mainNetInflowPercent || 0) : Number(item.changePercent || 0),
            })),
            watchlist: watchlistQuotes.value.slice(0, 8).map((item) => ({
              code: item.code,
              name: item.name,
              price: item.quote.price,
              changePercent: item.quote.changePercent,
            })),
            recommendationCandidates,
            facts: aiContext.value?.facts || [],
          },
          financialNews: (newsData.value?.latest || []).slice(0, 24).map((item) => ({
            title: item.title,
            source: item.source || '快讯',
            publishTime: item.publishTime || '',
            content: item.content || '',
          })),
        }, {
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
      if (homeDigestAutoEnabled.value && isTradingSession.value) {
        await requestDigest()
      }
    }, {
      intervalMultiplier: 1,
      immediate: false,
      minimumMs: 15000,
      pauseWhenHidden: true,
      market: () => currentMarket.value,
      skipWhenMarketClosed: false,
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
      activeTab,
      marketTabs,
      homeTabs,
      tabs,
      pulseCards,
      visibleIndices,
      currentBreadthSourceLabel,
      aiDigest,
      aiDigestError,
      aiDigestLoading,
      aiContext,
      marketMood,
      heroRealtimeActive,
      homeDigestAutoEnabled,
      isInitialLoading,
      selectedSectorCode,
      sectorMembers,
      sectorMembersLoading,
      selectedStockCode,
      stockDetail,
      stockDetailLoading,
      formatPrice,
      formatPercent,
      formatAmount,
      formatTurnoverPulse,
      isTurnoverPulseCard,
      switchMarket,
      navigateToStock,
      selectSector,
      selectStock,
      requestDigest,
      cancelHomeAiDigest,
    }
  },
})
