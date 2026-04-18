import { defineComponent, ref, computed, nextTick, onActivated, onBeforeUnmount, onDeactivated, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import { invoke } from '@tauri-apps/api/core'
import { useSidecar } from '@/composables/useSidecar'
import { getBoardAlertLabel, isBoardAlertType, useNotifications } from '@/composables/useNotifications'
import { useRealtimeTask } from '@/composables/useRealtimeTask'
import { useAiTaskLogger } from '@/composables/useAiTaskLogger'
import { useSettingsStore } from '@/stores/settings'
import { useMarketStore } from '@/stores/market'
import { useStrategyStore } from '@/stores/strategy'
import type { AiDiagnosis, KlineData, NotificationAlert, NotificationAlertType, Strategy } from '@/types'
import { formatAmount, formatPercent, formatPrice, formatVolume } from '@/utils/format'
import { buildTechnicalSnapshot, getLimitPrices, getStockProfile } from '@/utils/marketMetrics'
import { getMarketSessionContext } from '@/utils/marketSession'
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
    const strategyStore = useStrategyStore()
    const notifications = useNotifications()
    const aiTaskLogger = useAiTaskLogger()
    const { get } = useSidecar()

    const code = computed(() => normalizeSecurityCode((route.params.code as string) || ''))
    const period = ref('daily')
    const adjust = ref('qfq')
    const klineLimit = ref(120)
    const selectedStrategyId = ref('ai_comprehensive')
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
    const newsLoading = ref(false)
    const diagnosis = ref<AiDiagnosis | null>(null)
    const diagnosisLoading = ref(false)
    const diagnosisError = ref('')
    const guardRuleType = ref<string>('limit_up_touch')
    const guardPriceValue = ref<number | undefined>(undefined)
    const guardDelivery = ref<string>('desktop')
    const alertFeedback = ref('')
    const showEvidence = ref(false)
    const showTrace = ref(false)
    const companyTab = ref<'overview' | 'finance'>('overview')
    const financeReport = ref<any>(null)
    const financeReportLoading = ref(false)
    const financeReportError = ref('')
    const metricRail = ref<HTMLElement | null>(null)
    const technicalRail = ref<HTMLElement | null>(null)
    const metricCanPrev = ref(false)
    const metricCanNext = ref(false)
    const technicalCanPrev = ref(false)
    const technicalCanNext = ref(false)
    const quoteUpdatedAt = ref(0)
    const newsUpdatedAt = ref(0)
    const lastDiagnosisAt = ref(0)
    const diagnosisTaskId = ref<string | null>(null)
    const detailLoadSeq = ref(0)

    const profile = computed(() => getStockProfile(code.value))
    const realtimeMarket = computed(() => (profile.value.market === 'hk' ? 'hk' : profile.value.market === 'us' ? 'us' : 'a'))
    const isTradingSession = computed(() => getMarketSessionContext(realtimeMarket.value).phase === 'trading')
    const stockDiagnosisAutoEnabled = computed(() => settingsStore.settings.ai.autoRun.stockDetailDiagnosis)
    const strategyOptions = computed(() =>
      [...strategyStore.strategies].sort(
        (a, b) => Number(b.enabled) - Number(a.enabled) || Number(b.builtin) - Number(a.builtin) || a.name.localeCompare(b.name),
      ),
    )
    const selectedStrategy = computed<Strategy | null>(() =>
      strategyOptions.value.find((item) => item.id === selectedStrategyId.value) ?? null,
    )
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
    const guardRuleOptions = [
      { value: 'limit_up_touch', label: '涨停触发' },
      { value: 'limit_break', label: '涨停开板' },
      { value: 'limit_up_reseal', label: '涨停回封' },
      { value: 'limit_down', label: '跌停触发' },
      { value: 'limit_down_open', label: '跌停开板' },
      { value: 'price_above', label: '突破价格' },
      { value: 'price_below', label: '跌破价格' },
    ]
    const guardNeedsPrice = computed(() => guardRuleType.value.startsWith('price_'))
    const guardPriceDirection = computed<'above' | 'below'>(() => guardRuleType.value === 'price_above' ? 'above' : 'below')

    const deliveryOptions = computed(() => {
      const options = [{ value: 'desktop', label: '桌面通知', disabled: false }]
      for (const ch of settingsStore.settings.integrations.openClaw.channels) {
        const channelLabel = ch.channelType === 'wechat' ? '微信' : ch.channelType === 'qywx' ? '企业微信' : ch.name
        const connected = channelStatusMap.value[ch.id]?.listening || channelStatusMap.value[ch.id]?.loggedIn
        options.push({
          value: ch.id,
          label: `${channelLabel}: ${ch.name}${connected ? '' : '（未连接）'}`,
          disabled: !connected,
        })
      }
      return options
    })
    const channelStatusMap = ref<Record<string, { loggedIn: boolean; listening: boolean }>>({})
    const defaultDeliveryValue = computed(() => {
      const firstConnected = deliveryOptions.value.find((o) => o.value !== 'desktop' && !o.disabled)
      return firstConnected?.value ?? 'desktop'
    })
    const guardCanAdd = computed(() => {
      if (guardNeedsPrice.value) {
        return guardPriceValue.value != null && guardPriceValue.value > 0
      }
      return !alertsForStock.value.some((item) => item.type === guardRuleType.value)
    })

    function ensureSelectedStrategy() {
      if (strategyOptions.value.some((item) => item.id === selectedStrategyId.value)) return
      selectedStrategyId.value = strategyOptions.value.find((item) => item.id === 'ai_comprehensive')?.id
        || strategyOptions.value.find((item) => item.enabled)?.id
        || strategyOptions.value[0]?.id
        || ''
    }

    function isStaleDetailLoad(seq: number, targetCode: string) {
      return seq !== detailLoadSeq.value || targetCode !== code.value
    }

    function wait(ms: number) {
      return new Promise<void>((resolve) => {
        window.setTimeout(resolve, ms)
      })
    }

    async function retryDetailLoad(
      loader: (seq: number) => Promise<boolean>,
      seq: number,
      targetCode: string,
      options: { attempts?: number; delayMs?: number } = {},
    ) {
      const attempts = options.attempts ?? 2
      const delayMs = options.delayMs ?? 1200
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        if (isStaleDetailLoad(seq, targetCode)) return false
        await wait(delayMs * (attempt + 1))
        if (isStaleDetailLoad(seq, targetCode)) return false
        const loaded = await loader(seq)
        if (loaded || isStaleDetailLoad(seq, targetCode)) return loaded
      }
      return false
    }

    function hydrateFromCache(targetCode: string) {
      const cachedQuote = marketStore.quotes.get(targetCode)
      const cachedListItem = marketStore.stockList.find((item) => item.code === targetCode)
      const cached = cachedQuote || cachedListItem
      if (!cached) return

      stockInfo.value = {
        code: targetCode,
        name: cached.name,
        price: cached.price,
        open: cached.open,
        high: cached.high,
        low: cached.low,
        preClose: cached.preClose,
        change: cached.change,
        changePercent: cached.changePercent,
        volume: cached.volume,
        amount: cached.amount,
        turnover: cached.turnover,
        date: stockInfo.value?.date || '',
        time: stockInfo.value?.time || '',
        bids: stockInfo.value?.code === targetCode ? stockInfo.value.bids : [],
        asks: stockInfo.value?.code === targetCode ? stockInfo.value.asks : [],
      }
      finance.value = {
        ...finance.value,
        turnover: cached.turnover,
        pe: cachedListItem?.pe ?? finance.value.pe,
        pb: cachedListItem?.pb ?? finance.value.pb,
        totalMv: cachedListItem?.totalMv ?? finance.value.totalMv,
        circMv: cachedListItem?.circMv ?? finance.value.circMv,
      }
    }

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

    async function loadInfo(seq = detailLoadSeq.value) {
      const targetCode = code.value
      if (!targetCode) return false
      try {
        const res = await get<{ info: StockInfo; finance: FinanceInfo }>(`/api/market/stock/${targetCode}/info`)
        if (isStaleDetailLoad(seq, targetCode)) return false
        stockInfo.value = res.info
        finance.value = res.finance
        quoteUpdatedAt.value = Date.now()
        return true
      } catch (error) {
        console.error('Failed to load stock info:', error)
        return false
      }
    }

    async function loadKline(options: { silent?: boolean; seq?: number } = {}) {
      const targetCode = code.value
      const seq = options.seq ?? detailLoadSeq.value
      if (!targetCode) return false
      if (!options.silent) {
        klineLoading.value = true
      }
      try {
        const res = await get<{ data: KlineData[] }>(`/api/kline/${targetCode}?period=${period.value}&adjust=${adjust.value}&limit=${klineLimit.value}`)
        if (isStaleDetailLoad(seq, targetCode)) return false
        klineData.value = res.data
        return true
      } catch (error) {
        console.error('Failed to load kline:', error)
        return false
      } finally {
        if (!options.silent) {
          klineLoading.value = false
        }
      }
    }

    async function loadNews(seq = detailLoadSeq.value) {
      const targetCode = code.value
      if (!targetCode) return false
      newsLoading.value = true
      try {
        const targetName = stockInfo.value?.code === targetCode
          ? stockInfo.value.name
          : marketStore.stockList.find((item) => item.code === targetCode)?.name || ''
        const encodedName = encodeURIComponent(targetName)
        const [stockRes, macroRes] = await Promise.all([
          get<{ data: NewsItem[] }>(`/api/news/stock/${targetCode}?limit=20&name=${encodedName}`),
          get<{ data: NewsItem[] }>(`/api/news/context/${targetCode}?limit=24&name=${encodedName}`),
        ])
        if (isStaleDetailLoad(seq, targetCode)) return false
        stockNews.value = stockRes.data ?? []
        macroNews.value = macroRes.data ?? []
        newsUpdatedAt.value = Date.now()
        return true
      } catch (error) {
        console.error('Failed to load news:', error)
        return false
      } finally {
        newsLoading.value = false
      }
    }

    async function runDiagnosis() {
      diagnosisError.value = ''
      if (!settingsStore.isAiProviderConfigured(settingsStore.activeProvider)) {
        diagnosisError.value = '当前未配置 AI 模型，无法进行智能诊断。请先前往「设置 → 大模型」配置 API 地址、API Key 和模型名称后再使用。'
        return
      }
      const task = aiTaskLogger.createTask(`AI评估 ${stockInfo.value?.name || code.value}`, 'stockDetail')
      diagnosisTaskId.value = task.id
      diagnosisLoading.value = true
      aiTaskLogger.addLog(task.id, `开始诊断 ${stockInfo.value?.name || code.value}...`)

      try {
        aiTaskLogger.addLog(task.id, '正在获取行情与K线数据...')

        const result = await runDiagnosisAgent({
          code: code.value,
          provider: settingsStore.activeProvider,
          searchProviders: settingsStore.enabledSearchProviders,
          activeSearchProvider: settingsStore.activeSearchProvider,
          maxSteps: settingsStore.settings.ai.diagnosis.maxSteps,
          period: period.value,
          adjust: adjust.value,
          selectedStrategy: selectedStrategy.value,
          abortSignal: task.abortController?.signal,
          onProgress: (event) => {
            aiTaskLogger.addProgressLog(task.id, event.step)
          },
        })
        stockInfo.value = result.stockInfo
        finance.value = result.finance
        stockNews.value = result.stockNews
        macroNews.value = result.macroNews
        diagnosis.value = result.diagnosis

        if (aiTaskLogger.isTaskCancelled(task.id)) {
          aiTaskLogger.addLog(task.id, '评估已被取消', 'warn')
        } else {
          aiTaskLogger.addLog(task.id, `AI评估完成，建议：${result.diagnosis?.recommendation || '待确认'}`, 'success')
          aiTaskLogger.completeTask(task.id, true)
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        if (aiTaskLogger.isTaskCancelled(task.id)) {
          aiTaskLogger.addLog(task.id, '评估已被取消', 'warn')
        } else {
          aiTaskLogger.addLog(task.id, `评估失败：${msg}`, 'error')
          aiTaskLogger.completeTask(task.id, false, msg)
        }
        diagnosisError.value = msg
      } finally {
        diagnosisLoading.value = false
        diagnosisTaskId.value = null
      }
    }

    async function requestDiagnosis(force = false) {
      if (!force && !stockDiagnosisAutoEnabled.value) return
      if (!stockInfo.value || !klineData.value.length) return
      if (diagnosisLoading.value) return
      const now = Date.now()
      if (!force && now - lastDiagnosisAt.value < settingsStore.settings.ai.autoRunInterval * 1000) return
      lastDiagnosisAt.value = now
      await runDiagnosis()
    }

    function cancelDiagnosis() {
      if (diagnosisTaskId.value) {
        aiTaskLogger.cancelTask(diagnosisTaskId.value)
        diagnosisLoading.value = false
        diagnosisTaskId.value = null
      }
    }

    async function toggleWatchlist() {
      if (!stockInfo.value) return
      if (isWatched.value) {
        await marketStore.removeFromWatchList(code.value)
        alertFeedback.value = '已从关注列表移除'
      } else {
        await marketStore.addToWatchList({
          code: stockInfo.value.code,
          name: stockInfo.value.name,
          addedAt: Date.now(),
        })
        alertFeedback.value = '已加入关注列表'
      }
    }

    async function loadFinanceReport() {
      if (!code.value) return
      if (financeReport.value && !financeReportError.value) return
      financeReportLoading.value = true
      financeReportError.value = ''
      try {
        const res = await get<{ data: any }>(`/api/finance/summary/${code.value}`)
        financeReport.value = res.data
        if (!res.data || (!res.data.balanceSheet?.length && !res.data.incomeStatement?.length)) {
          financeReportError.value = '该股票暂无财报数据'
        }
      } catch (error) {
        financeReportError.value = '财报数据加载失败，请确认 Sidecar 已重启'
        console.error('Failed to load finance report:', error)
      } finally {
        financeReportLoading.value = false
      }
    }

    async function addGuardRule() {
      if (!stockInfo.value) return
      const type = guardRuleType.value
      const delivery = guardDelivery.value

      if (type.startsWith('price_')) {
        if (guardPriceValue.value == null || guardPriceValue.value <= 0) return
        const dir = type === 'price_above' ? 'above' : 'below'
        const created = await notifications.addAlert(
          stockInfo.value.code,
          stockInfo.value.name,
          guardPriceValue.value,
          dir,
          delivery,
        )
        await notifications.fetchAlerts()
        if (created) {
          alertFeedback.value = `已添加${dir === 'above' ? '突破' : '跌破'} ${guardPriceValue.value.toFixed(2)} 提醒`
          guardPriceValue.value = undefined
        } else {
          alertFeedback.value = '该价格提醒已存在'
        }
      } else if (isBoardAlertType(type as NotificationAlertType)) {
        const boardType = type as NotificationAlertType
        const created = await notifications.addBoardAlert(
          stockInfo.value.code,
          stockInfo.value.name,
          boardType as Exclude<NotificationAlertType, 'price'>,
          delivery,
        )
        await notifications.fetchAlerts()
        const label = guardRuleOptions.find((o) => o.value === type)?.label ?? type
        alertFeedback.value = created ? `已添加 ${label} 提醒` : `${label} 提醒已存在`
      }
    }

    async function refreshChannelStatuses() {
      for (const ch of settingsStore.settings.integrations.openClaw.channels) {
        if (ch.channelType !== 'wechat') continue
        try {
          const status = await invoke<{ loggedIn: boolean; listening: boolean }>('wechat_get_channel_status', { channelId: ch.id })
          channelStatusMap.value[ch.id] = { loggedIn: status.loggedIn, listening: status.listening }
        } catch {}
      }
    }

    function getAlertLabel(item: NotificationAlert) {
      if (item.type === 'price') {
        return `${item.direction === 'above' ? '突破' : '跌破'} ${Number(item.targetPrice).toFixed(2)}`
      }
      return guardRuleOptions.find((o) => o.value === item.type)?.label ?? getBoardAlertLabel(item.type)
    }

    async function removeAlert(id: string) {
      await notifications.removeAlert(id)
      await notifications.fetchAlerts()
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
      if (typeof value === 'string' && value !== 'all' && value !== 'wechat') {
        const ch = settingsStore.settings.integrations.openClaw.channels.find((c) => c.id === value)
        if (ch) return ch.name
      }
      if (value === 'wechat') return '仅微信'
      return '桌面 + 微信'
    }

    const quoteRealtime = useRealtimeTask(async () => {
      if (!isTradingSession.value) return
      await loadInfo()
    }, {
      immediate: false,
      intervalMultiplier: 1,
      minimumMs: 3000,
      pauseWhenHidden: true,
      market: () => realtimeMarket.value,
      skipWhenMarketClosed: true,
    })

    const newsRealtime = useRealtimeTask(async () => {
      await loadNews()
    }, {
      immediate: false,
      intervalMultiplier: 2,
      minimumMs: 15000,
      pauseWhenHidden: true,
    })
    const klineRealtime = useRealtimeTask(async () => {
      if (!isTradingSession.value) return
      await loadKline({ silent: true })
    }, {
      immediate: false,
      intervalMultiplier: 2,
      minimumMs: 10000,
      pauseWhenHidden: true,
      market: () => realtimeMarket.value,
      skipWhenMarketClosed: true,
    })
    const diagnosisRealtime = useRealtimeTask(async () => {
      if (!isTradingSession.value) return
      await requestDiagnosis()
    }, {
      enabled: () => stockDiagnosisAutoEnabled.value,
      immediate: false,
      intervalSource: 'ai',
      intervalMultiplier: 1,
      minimumMs: 10000,
      pauseWhenHidden: true,
      market: () => realtimeMarket.value,
      skipWhenMarketClosed: true,
    })

    async function loadDeferredData(seq: number) {
      const targetCode = code.value
      if (!targetCode) return
      void notifications.init()
      void notifications.fetchAlerts()

      const [newsLoaded, klineLoaded] = await Promise.allSettled([
        loadNews(seq),
        loadKline({ seq }),
      ])
      if (isStaleDetailLoad(seq, targetCode)) return

      if (newsLoaded.status !== 'fulfilled' || !newsLoaded.value) {
        void retryDetailLoad(loadNews, seq, targetCode, { attempts: 2, delayMs: 1500 })
      }
      if (klineLoaded.status !== 'fulfilled' || !klineLoaded.value) {
        void retryDetailLoad((currentSeq) => loadKline({ seq: currentSeq }), seq, targetCode, { attempts: 2, delayMs: 1500 })
      }

      await nextTick()
      syncAllRailStates()
      if (klineLoaded.status === 'fulfilled' && klineLoaded.value) {
        void requestDiagnosis()
      }
    }

    async function loadAll() {
      const seq = detailLoadSeq.value + 1
      detailLoadSeq.value = seq
      const targetCode = code.value
      if (!targetCode) return
      ensureSelectedStrategy()
      hydrateFromCache(targetCode)
      const infoLoaded = await loadInfo(seq)
      if (isStaleDetailLoad(seq, targetCode)) return
      if (!infoLoaded) {
        void retryDetailLoad(loadInfo, seq, targetCode, { attempts: 2, delayMs: 1200 })
      }
      await nextTick()
      syncAllRailStates()
      void loadDeferredData(seq)
    }

    function bindDetailEvents() {
      window.addEventListener('resize', syncAllRailStates)
    }

    function unbindDetailEvents() {
      window.removeEventListener('resize', syncAllRailStates)
    }

    function startRealtimeTasks() {
      quoteRealtime.start(false)
      newsRealtime.start(false)
      klineRealtime.start(false)
      diagnosisRealtime.start(false)
    }

    function stopRealtimeTasks() {
      quoteRealtime.stop()
      newsRealtime.stop()
      klineRealtime.stop()
      diagnosisRealtime.stop()
    }

    onMounted(async () => {
      await loadAll()
      await refreshChannelStatuses()
      guardDelivery.value = defaultDeliveryValue.value
      bindDetailEvents()
      startRealtimeTasks()
    })

    onBeforeUnmount(() => {
      unbindDetailEvents()
      stopRealtimeTasks()
    })

    onActivated(async () => {
      bindDetailEvents()
      if (!isTradingSession.value) {
        await Promise.allSettled([loadInfo(), loadKline(), loadNews()])
        await nextTick()
        syncAllRailStates()
      }
      startRealtimeTasks()
      void nextTick(() => syncAllRailStates())
    })

    onDeactivated(() => {
      unbindDetailEvents()
      stopRealtimeTasks()
    })

    watch(code, async () => {
      cancelDiagnosis()
      diagnosis.value = null
      alertFeedback.value = ''
      guardPriceValue.value = undefined
      guardRuleType.value = 'limit_up_touch'
      companyTab.value = 'overview'
      financeReport.value = null
      financeReportError.value = ''
      stockNews.value = []
      macroNews.value = []
      klineData.value = []
      lastDiagnosisAt.value = 0
      stockInfo.value = null
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
      newsLoading,
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
      guardRuleType,
      guardRuleOptions,
      guardNeedsPrice,
      guardPriceValue,
      guardPriceDirection,
      guardDelivery,
      guardCanAdd,
      deliveryOptions,
      alertsForStock,
      alertFeedback,
      showEvidence,
      showTrace,
      companyTab,
      financeReport,
      financeReportLoading,
      financeReportError,
      getAlertLabel,
      metricRail,
      technicalRail,
      metricCanPrev,
      metricCanNext,
      technicalCanPrev,
      technicalCanNext,
      selectedStrategyId,
      selectedStrategy,
      strategyOptions,
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
      cancelDiagnosis,
      toggleWatchlist,
      addGuardRule,
      loadFinanceReport,
      removeAlert,
      loadKline,
    }
  },
})
