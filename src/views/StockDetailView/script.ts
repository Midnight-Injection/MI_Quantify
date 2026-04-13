import { defineComponent, ref, computed, nextTick, onBeforeUnmount, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useSidecar } from '@/composables/useSidecar'
import { BOARD_ALERT_TYPES, getBoardAlertLabel, isBoardAlertType, type BoardAlertType, useNotifications } from '@/composables/useNotifications'
import { useRealtimeTask } from '@/composables/useRealtimeTask'
import { useSettingsStore } from '@/stores/settings'
import { useMarketStore } from '@/stores/market'
import type { AiDiagnosis, KlineData, NotificationAlertType } from '@/types'
import { formatAmount, formatPercent, formatPrice, formatVolume } from '@/utils/format'
import { buildTechnicalSnapshot, getLimitPrices, getStockProfile } from '@/utils/marketMetrics'
import { runDiagnosisAgent } from '@/agents/diagnosisAgent'
import { normalizeSecurityCode } from '@/utils/security'
import KlineChart from '@/components/analysis/KlineChart/index.vue'
import InfoTooltip from '@/components/common/InfoTooltip/index.vue'

interface BidAsk {
  price: number
  volume: number
}

interface StockInfo {
  code: string
  name: string
  price: number
  open: number
  high: number
  low: number
  preClose: number
  change: number
  changePercent: number
  volume: number
  amount: number
  turnover: number
  date: string
  time: string
  bids: BidAsk[]
  asks: BidAsk[]
}

interface FinanceInfo {
  pe: number
  pb: number
  totalMv: number
  circMv: number
  roe: number
  eps: number
  bps: number
  turnover: number
}

interface NewsItem {
  id?: string
  title: string
  url: string
  source: string
  publishTime: string
  summary?: string
  content?: string
}

export default defineComponent({
  name: 'StockDetailView',
  components: { KlineChart, InfoTooltip },
  setup() {
    const route = useRoute()
    const settingsStore = useSettingsStore()
    const marketStore = useMarketStore()
    const notifications = useNotifications()
    const { get } = useSidecar()

    const code = computed(() => normalizeSecurityCode((route.params.code as string) || ''))
    const period = ref('daily')
    const adjust = ref('qfq')
    const klineLimit = ref(120)
    const klineData = ref<KlineData[]>([])
    const klineLoading = ref(false)
    const stockInfo = ref<StockInfo | null>(null)
    const finance = ref<FinanceInfo>({
      pe: 0,
      pb: 0,
      totalMv: 0,
      circMv: 0,
      roe: 0,
      eps: 0,
      bps: 0,
      turnover: 0,
    })
    const stockNews = ref<NewsItem[]>([])
    const macroNews = ref<NewsItem[]>([])
    const diagnosis = ref<AiDiagnosis | null>(null)
    const diagnosisLoading = ref(false)
    const diagnosisError = ref('')
    const quickAlertPrice = ref<number | null>(null)
    const quickAlertDirection = ref<'above' | 'below'>('above')
    const alertDelivery = ref<'all' | 'desktop' | 'wechat'>('all')
    const alertFeedback = ref('')
    const boardAlertMenuOpen = ref(false)
    const boardAlertMenuRef = ref<HTMLElement | null>(null)
    const selectedBoardAlertTypes = ref<BoardAlertType[]>([])
    const metricRail = ref<HTMLElement | null>(null)
    const technicalRail = ref<HTMLElement | null>(null)
    const metricCanPrev = ref(false)
    const metricCanNext = ref(false)
    const technicalCanPrev = ref(false)
    const technicalCanNext = ref(false)
    const quoteUpdatedAt = ref(0)
    const newsUpdatedAt = ref(0)
    const lastDiagnosisAt = ref(0)

    const profile = computed(() => getStockProfile(code.value))
    const stockDiagnosisAutoEnabled = computed(() => settingsStore.settings.ai.autoRun.stockDetailDiagnosis)
    const technical = computed(() => buildTechnicalSnapshot(klineData.value))
    const klineChartKey = computed(() => `${code.value}_${period.value}_${adjust.value}_${klineLimit.value}_${klineData.value.length}_${klineData.value[0]?.timestamp || 0}_${klineData.value[klineData.value.length - 1]?.timestamp || 0}`)
    const limitPrices = computed(() =>
      stockInfo.value ? getLimitPrices(stockInfo.value.code, stockInfo.value.preClose) : { limitUp: 0, limitDown: 0, ratio: 0 },
    )
    const amplitude = computed(() => {
      if (!stockInfo.value || !stockInfo.value.preClose) return '-'
      return `${(((stockInfo.value.high - stockInfo.value.low) / stockInfo.value.preClose) * 100).toFixed(2)}%`
    })

    const bidTotalVol = computed(() => (stockInfo.value?.bids || []).reduce((sum, item) => sum + item.volume, 0))
    const askTotalVol = computed(() => (stockInfo.value?.asks || []).reduce((sum, item) => sum + item.volume, 0))
    const bidRatio = computed(() => {
      const total = bidTotalVol.value + askTotalVol.value
      return total ? (bidTotalVol.value / total) * 100 : 0
    })
    const alertsForStock = computed(() =>
      notifications.alerts.value.filter((item) => item.stockCode === code.value),
    )
    const isWatched = computed(() => marketStore.watchList.some((item) => item.code === code.value))
    const agentTrace = computed(() => diagnosis.value?.toolCalls ?? [])
    const diagnosisEvidence = computed(() => diagnosis.value?.evidence ?? [])
    const liveVolumeRatio = computed(() => {
      if (!stockInfo.value || !technical.value.avgVolume5) return 0
      return stockInfo.value.volume / technical.value.avgVolume5
    })
    const volumeSignal = computed(() => {
      const ratio = liveVolumeRatio.value
      if (!ratio) {
        return {
          value: '--',
          summary: '等待实时量能同步',
        }
      }
      return {
        value: `${ratio.toFixed(2)}x`,
        summary: ratio >= 1.6 ? '显著放量' : ratio >= 1.05 ? '温和放量' : '低于5日均量',
      }
    })
    const trendSignal = computed(() => {
      const tone = technical.value.trend === 'bullish' ? '多头延续' : technical.value.trend === 'bearish' ? '空头承压' : '区间震荡'
      const momentum = technical.value.momentum === 'strong' ? '动量偏强' : technical.value.momentum === 'weak' ? '动量偏弱' : '动量中性'
      return {
        value: tone,
        summary: momentum,
      }
    })
    const latestBar = computed(() => {
      const latest = klineData.value[klineData.value.length - 1]
      if (!latest) return null
      return {
        ...latest,
        rangePct: latest.low ? (((latest.high - latest.low) / latest.low) * 100).toFixed(2) : '--',
      }
    })
    const aiSignalCards = computed(() => {
      if (!diagnosis.value) return []
      return [
        {
          label: '建议买入',
          value: diagnosis.value.buyLower && diagnosis.value.buyUpper
            ? `${formatPrice(diagnosis.value.buyLower)} - ${formatPrice(diagnosis.value.buyUpper)}`
            : '--',
          tone: 'buy',
        },
        {
          label: '建议卖出',
          value: diagnosis.value.sellLower && diagnosis.value.sellUpper
            ? `${formatPrice(diagnosis.value.sellLower)} - ${formatPrice(diagnosis.value.sellUpper)}`
            : '--',
          tone: 'sell',
        },
        {
          label: '情绪判断',
          value: diagnosis.value.prediction || '观察中',
          tone: diagnosis.value.prediction === '看多' ? 'buy' : diagnosis.value.prediction === '看空' ? 'sell' : 'neutral',
        },
        {
          label: '仓位建议',
          value: diagnosis.value.positionSize || diagnosis.value.positionAdvice || '--',
          tone: 'neutral',
        },
      ]
    })
    const pePbDisplay = computed(() => `${finance.value.pe ? finance.value.pe.toFixed(2) : '--'} / ${finance.value.pb ? finance.value.pb.toFixed(2) : '--'}`)
    const marketCapDisplay = computed(() => `${fmtCap(finance.value.totalMv)} / ${fmtCap(finance.value.circMv)}`)
    const boardAlertOptions = computed(() =>
      BOARD_ALERT_TYPES.map((type) => ({
        type,
        label: getBoardAlertLabel(type),
        active: alertsForStock.value.some((item) => item.type === type),
      })),
    )
    const selectedBoardAlertLabels = computed(() =>
      boardAlertOptions.value
        .filter((item) => selectedBoardAlertTypes.value.includes(item.type))
        .map((item) => item.label),
    )

    function metricValueClass(value: string) {
      const compactLength = value.replace(/\s+/g, '').length
      if (compactLength >= 18) return 'metric-value--tight'
      if (compactLength >= 12) return 'metric-value--compact'
      return ''
    }

    function resolveRail(type: 'metric' | 'technical') {
      return type === 'metric' ? metricRail.value : technicalRail.value
    }

    function syncRailState(type: 'metric' | 'technical') {
      const rail = resolveRail(type)
      const prev = rail ? rail.scrollLeft > 8 : false
      const next = rail ? rail.scrollLeft + rail.clientWidth < rail.scrollWidth - 8 : false
      if (type === 'metric') {
        metricCanPrev.value = prev
        metricCanNext.value = next
        return
      }
      technicalCanPrev.value = prev
      technicalCanNext.value = next
    }

    function syncAllRailStates() {
      syncRailState('metric')
      syncRailState('technical')
    }

    function scrollRail(type: 'metric' | 'technical', direction: -1 | 1) {
      const rail = resolveRail(type)
      if (!rail) return
      rail.scrollBy({
        left: Math.round(rail.clientWidth * 0.78) * direction,
        behavior: 'smooth',
      })
      window.setTimeout(() => syncRailState(type), 220)
    }

    function handleRailWheel(event: WheelEvent, type: 'metric' | 'technical') {
      const rail = resolveRail(type)
      if (!rail) return
      if (!event.shiftKey && Math.abs(event.deltaX) < Math.abs(event.deltaY)) return
      event.preventDefault()
      rail.scrollBy({
        left: event.deltaX || event.deltaY,
        behavior: 'auto',
      })
      syncRailState(type)
    }

    async function loadInfo() {
      if (!code.value) return
      try {
        const res = await get<{ info: StockInfo; finance: FinanceInfo }>(`/api/market/stock/${code.value}/info`)
        stockInfo.value = res.info
        finance.value = res.finance
        quoteUpdatedAt.value = Date.now()
        if (!quickAlertPrice.value) {
          quickAlertPrice.value = Number(res.info.price.toFixed(2))
        }
      } catch (error) {
        console.error('Failed to load stock info:', error)
      }
    }

    async function loadKline(options: { silent?: boolean } = {}) {
      if (!code.value) return
      if (!options.silent) {
        klineLoading.value = true
      }
      try {
        const res = await get<{ data: KlineData[] }>(`/api/kline/${code.value}?period=${period.value}&adjust=${adjust.value}&limit=${klineLimit.value}`)
        klineData.value = res.data
      } catch (error) {
        console.error('Failed to load kline:', error)
      } finally {
        if (!options.silent) {
          klineLoading.value = false
        }
      }
    }

    async function loadNews() {
      if (!code.value) return
      try {
        const [stockRes, macroRes] = await Promise.all([
          get<{ data: NewsItem[] }>(`/api/news/stock/${code.value}?limit=6`),
          get<{ data: NewsItem[] }>(`/api/news/context/${code.value}?limit=6&name=${encodeURIComponent(stockInfo.value?.name || '')}`),
        ])
        stockNews.value = stockRes.data ?? []
        macroNews.value = macroRes.data ?? []
        newsUpdatedAt.value = Date.now()
      } catch (error) {
        console.error('Failed to load news:', error)
      }
    }

    async function runDiagnosis() {
      diagnosisError.value = ''

      diagnosisLoading.value = true
      try {
        const result = await runDiagnosisAgent({
          code: code.value,
          provider: settingsStore.activeProvider,
          searchProviders: settingsStore.enabledSearchProviders,
          activeSearchProvider: settingsStore.activeSearchProvider,
          maxSteps: settingsStore.settings.ai.diagnosis.maxSteps,
          period: period.value,
          adjust: adjust.value,
        })
        stockInfo.value = result.stockInfo
        finance.value = result.finance
        stockNews.value = result.stockNews
        macroNews.value = result.macroNews
        diagnosis.value = result.diagnosis
        if (!settingsStore.activeProvider) {
          diagnosisError.value = '当前未启用模型，已退回到本地规则诊股结论。'
        }
      } catch (error) {
        diagnosisError.value = error instanceof Error ? error.message : String(error)
      } finally {
        diagnosisLoading.value = false
      }
    }

    async function requestDiagnosis(force = false) {
      if (!force && !stockDiagnosisAutoEnabled.value) return
      if (!stockInfo.value || !klineData.value.length) return
      if (diagnosisLoading.value) return
      const now = Date.now()
      if (!force && now - lastDiagnosisAt.value < 90000) return
      lastDiagnosisAt.value = now
      await runDiagnosis()
    }

    async function addToWatchlist() {
      if (!stockInfo.value) return
      await marketStore.addToWatchList({
        code: stockInfo.value.code,
        name: stockInfo.value.name,
        addedAt: Date.now(),
      })
      alertFeedback.value = '已加入关注列表'
    }

    async function createPriceAlert() {
      if (!stockInfo.value || !quickAlertPrice.value) return
      await notifications.addAlert(
        stockInfo.value.code,
        stockInfo.value.name,
        quickAlertPrice.value,
        quickAlertDirection.value,
        alertDelivery.value,
      )
      alertFeedback.value = `已添加${quickAlertDirection.value === 'above' ? '突破' : '跌破'}提醒`
    }

    function toggleBoardAlertType(type: NotificationAlertType) {
      if (!isBoardAlertType(type)) return
      if (selectedBoardAlertTypes.value.includes(type)) {
        selectedBoardAlertTypes.value = selectedBoardAlertTypes.value.filter((item) => item !== type)
        return
      }
      selectedBoardAlertTypes.value = [...selectedBoardAlertTypes.value, type]
    }

    function handleDocumentClick(event: MouseEvent) {
      if (!boardAlertMenuRef.value) return
      if (event.target instanceof Node && boardAlertMenuRef.value.contains(event.target)) return
      boardAlertMenuOpen.value = false
    }

    async function createSelectedBoardAlerts() {
      if (!stockInfo.value || !selectedBoardAlertTypes.value.length) return
      const { added, skipped } = await notifications.addBoardAlerts(
        stockInfo.value.code,
        stockInfo.value.name,
        selectedBoardAlertTypes.value,
        alertDelivery.value,
      )
      await notifications.fetchAlerts()
      boardAlertMenuOpen.value = false
      if (added && skipped) {
        alertFeedback.value = `已新增 ${added} 条提醒，${skipped} 条已存在`
      } else if (added) {
        alertFeedback.value = `已新增 ${added} 条提醒`
      } else {
        alertFeedback.value = '所选提醒已存在'
      }
      selectedBoardAlertTypes.value = []
    }

    async function removeAlert(id: string) {
      await notifications.removeAlert(id)
      await notifications.fetchAlerts()
      alertFeedback.value = '已删除提醒'
    }

    function fmtCap(val: number) {
      if (!val || val <= 0) return '--'
      if (val >= 1e12) return `${(val / 1e12).toFixed(2)}万亿`
      if (val >= 1e8) return `${(val / 1e8).toFixed(2)}亿`
      return val.toFixed(0)
    }

    function fmtVol(val: number) {
      if (val >= 10000) return `${(val / 10000).toFixed(2)}万手`
      return `${val.toFixed(0)}手`
    }

    function fmtOrderbookVol(val: number) {
      if (!val) return '--'
      if (val >= 100000000) return `${(val / 100000000).toFixed(2)}亿`
      if (val >= 10000) return `${(val / 10000).toFixed(1)}万`
      if (val >= 1000) return `${(val / 1000).toFixed(1)}千`
      return `${val.toFixed(0)}`
    }

    function formatShortTime(value: string) {
      if (!value) return ''
      return value.slice(5, 16)
    }

    function formatVolumeRatio(value: number) {
      return value ? `${value.toFixed(2)}x` : '--'
    }

    function formatTrend(value: string) {
      if (value === 'bullish') return '多头'
      if (value === 'bearish') return '空头'
      return '震荡'
    }

    function formatSyncTime(value: number) {
      return value ? new Date(value).toLocaleTimeString('zh-CN', { hour12: false }) : '--'
    }

    function formatBarTime(value: number) {
      if (!value) return '--'
      return new Date(value).toLocaleString('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      })
    }

    function formatAlertDelivery(value?: string | number | boolean) {
      if (value === 'desktop') return '仅桌面'
      if (value === 'wechat') return '仅微信'
      return '桌面 + 微信'
    }

    const quoteRealtime = useRealtimeTask(async () => {
      await loadInfo()
      await requestDiagnosis()
    }, { immediate: false, intervalMultiplier: 1, minimumMs: 5000, pauseWhenHidden: true })

    const newsRealtime = useRealtimeTask(async () => {
      await loadNews()
      await requestDiagnosis()
    }, { immediate: false, intervalMultiplier: 4, minimumMs: 20000, pauseWhenHidden: true })
    const klineRealtime = useRealtimeTask(async () => {
      await loadKline({ silent: true })
      await requestDiagnosis()
    }, { immediate: false, intervalMultiplier: 3, minimumMs: 12000, pauseWhenHidden: true })

    async function loadAll() {
      await Promise.all([loadInfo(), loadKline(), loadNews(), notifications.init(), notifications.fetchAlerts()])
      await requestDiagnosis()
      await nextTick()
      syncAllRailStates()
    }

    onMounted(async () => {
      await loadAll()
      window.addEventListener('resize', syncAllRailStates)
      document.addEventListener('mousedown', handleDocumentClick)
      quoteRealtime.start(false)
      newsRealtime.start(false)
      klineRealtime.start(false)
    })

    onBeforeUnmount(() => {
      window.removeEventListener('resize', syncAllRailStates)
      document.removeEventListener('mousedown', handleDocumentClick)
    })

    watch(code, async () => {
      diagnosis.value = null
      alertFeedback.value = ''
      boardAlertMenuOpen.value = false
      selectedBoardAlertTypes.value = []
      lastDiagnosisAt.value = 0
      await loadAll()
    })
    watch(period, async () => {
      await loadKline()
      await nextTick()
      syncAllRailStates()
      await requestDiagnosis()
    })
    watch(adjust, async () => {
      await loadKline()
      await nextTick()
      syncAllRailStates()
      await requestDiagnosis()
    })
    watch(klineLimit, async () => {
      await loadKline()
      await nextTick()
      syncAllRailStates()
      await requestDiagnosis()
    })

    return {
      code,
      period,
      adjust,
      klineLimit,
      stockInfo,
      finance,
      stockNews,
      macroNews,
      profile,
      technical,
      limitPrices,
      amplitude,
      bidTotalVol,
      askTotalVol,
      bidRatio,
      diagnosis,
      diagnosisLoading,
      diagnosisError,
      agentTrace,
      diagnosisEvidence,
      stockDiagnosisAutoEnabled,
      klineChartKey,
      volumeSignal,
      trendSignal,
      latestBar,
      aiSignalCards,
      quoteUpdatedAt,
      newsUpdatedAt,
      quickAlertPrice,
      quickAlertDirection,
      alertDelivery,
      boardAlertMenuOpen,
      boardAlertMenuRef,
      boardAlertOptions,
      selectedBoardAlertTypes,
      selectedBoardAlertLabels,
      alertsForStock,
      alertFeedback,
      metricRail,
      technicalRail,
      metricCanPrev,
      metricCanNext,
      technicalCanPrev,
      technicalCanNext,
      isWatched,
      klineData,
      klineLoading,
      formatPrice,
      formatPercent,
      formatVolume,
      formatAmount,
      fmtCap,
      fmtVol,
      fmtOrderbookVol,
      formatShortTime,
      formatVolumeRatio,
      formatTrend,
      formatSyncTime,
      formatBarTime,
      formatAlertDelivery,
      metricValueClass,
      pePbDisplay,
      marketCapDisplay,
      syncRailState,
      scrollRail,
      handleRailWheel,
      runDiagnosis,
      requestDiagnosis,
      addToWatchlist,
      createPriceAlert,
      toggleBoardAlertType,
      createSelectedBoardAlerts,
      removeAlert,
      loadKline,
    }
  },
})
