import { computed, defineComponent, onActivated, onDeactivated, onMounted, ref, watch } from 'vue'
import type { AiDiagnosis, DiagnosisEvidence, KlineData, StockQuote } from '@/types'
import { useRealtimeTask } from '@/composables/useRealtimeTask'
import { useSettingsStore } from '@/stores/settings'
import { useMarketStore } from '@/stores/market'
import { buildTechnicalSnapshot, getStockProfile } from '@/utils/marketMetrics'
import { resolveStockFromInput } from '@/utils/aiQuestion'
import { formatAmount, formatPercent, formatPrice, formatVolume } from '@/utils/format'
import { runDiagnosisAgent, type DiagnosisFinanceInfo, type DiagnosisNewsItem, type DiagnosisStockInfo } from '@/agents/diagnosisAgent'
import KlineChart from '@/components/analysis/KlineChart/index.vue'
import StockSearchInput from '@/components/common/StockSearchInput/index.vue'

function formatShortTime(value?: string) {
  if (!value) return '--'
  return value.slice(5, 16)
}

export default defineComponent({
  name: 'AnalysisView',
  components: { KlineChart, StockSearchInput },
  setup() {
    const settingsStore = useSettingsStore()
    const marketStore = useMarketStore()
    const stockQuery = ref('')
    const resolvedStockCode = ref('')
    const period = ref('daily')
    const adjust = ref('qfq')
    const klineLimit = ref(120)
    const loading = ref(false)
    const diagnosisLoading = ref(false)
    const analysisError = ref('')
    const lastAnalysisAt = ref(0)

    const currentStock = ref<{ name: string; code: string } | null>(null)
    const currentQuote = ref<DiagnosisStockInfo | null>(null)
    const finance = ref<DiagnosisFinanceInfo>({
      pe: 0,
      pb: 0,
      totalMv: 0,
      circMv: 0,
      roe: 0,
      eps: 0,
      bps: 0,
      turnover: 0,
    })
    const stockNews = ref<DiagnosisNewsItem[]>([])
    const macroNews = ref<DiagnosisNewsItem[]>([])
    const policyEvidence = ref<DiagnosisEvidence[]>([])
    const diagnosis = ref<AiDiagnosis | null>(null)
    const klineData = ref<KlineData[]>([])

    function buildEvidenceNews(items: DiagnosisEvidence[]) {
      return items.map((item) => ({
        title: item.title,
        summary: item.summary,
        content: item.summary,
        source: item.source || '分析证据',
        url: '',
        publishTime: '',
      }))
    }

    function dedupeNews(items: DiagnosisNewsItem[]) {
      const seen = new Set<string>()
      const result: DiagnosisNewsItem[] = []
      for (const item of items) {
        const key = item.url || item.title
        if (!key || seen.has(key)) continue
        seen.add(key)
        result.push(item)
      }
      return result
    }

    function dedupeBullets(items: Array<string | undefined | null>, limit = 5) {
      const seen = new Set<string>()
      const result: string[] = []
      for (const item of items) {
        const normalized = `${item || ''}`.replace(/\s+/g, ' ').trim()
        if (!normalized || seen.has(normalized)) continue
        seen.add(normalized)
        result.push(normalized)
        if (result.length >= limit) break
      }
      return result
    }

    const technical = computed(() => buildTechnicalSnapshot(klineData.value))
    const profile = computed(() => getStockProfile(resolvedStockCode.value.trim()))
    const analysisAutoEnabled = computed(() => settingsStore.settings.ai.autoRun.analysisDigest)
    const klineChartKey = computed(
      () => `${resolvedStockCode.value}_${period.value}_${adjust.value}_${klineLimit.value}_${klineData.value.length}_${klineData.value[0]?.timestamp || 0}`,
    )

    const summaryCards = computed(() => [
      {
        label: '最新价格',
        value: currentQuote.value ? formatPrice(currentQuote.value.price) : '--',
        hint: currentQuote.value
          ? `${currentQuote.value.change >= 0 ? '+' : ''}${formatPrice(currentQuote.value.change)} / ${formatPercent(currentQuote.value.changePercent)}%`
          : '等待同步',
      },
      {
        label: '交易属性',
        value: profile.value.board,
        hint: `${profile.value.market.toUpperCase()} · ${profile.value.tags.join(' / ') || '普通股'}`,
      },
      {
        label: '估值快照',
        value: `${finance.value.pe ? finance.value.pe.toFixed(2) : '--'} / ${finance.value.pb ? finance.value.pb.toFixed(2) : '--'}`,
        hint: `PE / PB · 总市值 ${finance.value.totalMv ? formatAmount(finance.value.totalMv) : '--'}`,
      },
      {
        label: '技术结构',
        value: technical.value.trend === 'bullish' ? '偏强' : technical.value.trend === 'bearish' ? '承压' : '震荡',
        hint: `支撑 ${formatPrice(technical.value.supportPrice)} / 压力 ${formatPrice(technical.value.resistancePrice)}`,
      },
    ])

    const diagnosisCards = computed(() => {
      if (!diagnosis.value) return []
      return [
        {
          label: '建议买入',
          value: diagnosis.value.buyLower && diagnosis.value.buyUpper
            ? `${formatPrice(diagnosis.value.buyLower)} - ${formatPrice(diagnosis.value.buyUpper)}`
            : '--',
          hint: diagnosis.value.entryAdvice || '等待回踩确认后分批介入',
          tone: 'buy',
        },
        {
          label: '建议卖出',
          value: diagnosis.value.sellLower && diagnosis.value.sellUpper
            ? `${formatPrice(diagnosis.value.sellLower)} - ${formatPrice(diagnosis.value.sellUpper)}`
            : '--',
          hint: diagnosis.value.exitAdvice || '靠近目标区间后分批兑现',
          tone: 'sell',
        },
        {
          label: '止损 / 止盈',
          value: `${diagnosis.value.stopLossPrice ? formatPrice(diagnosis.value.stopLossPrice) : '--'} / ${diagnosis.value.takeProfitPrice ? formatPrice(diagnosis.value.takeProfitPrice) : '--'}`,
          hint: '先保护回撤，再考虑利润空间',
          tone: 'neutral',
        },
        {
          label: '仓位 / 股数',
          value: `${diagnosis.value.positionSize || '--'} / ${diagnosis.value.suggestedShares || '--'}`,
          hint: diagnosis.value.positionAdvice || '仓位需要服从止损与总风险',
          tone: 'neutral',
        },
      ]
    })

    const stockStimuli = computed(() => {
      const fallback = buildEvidenceNews(
        policyEvidence.value.filter((item) => (item.source || '').includes('个股') || (item.source || '').includes('外部') || item.title.includes(currentStock.value?.name || '')),
      )
      return dedupeNews([...stockNews.value, ...fallback]).slice(0, 6)
    })
    const macroStimuli = computed(() => {
      const fallback = buildEvidenceNews(
        policyEvidence.value.filter((item) => !(item.source || '').includes('实时行情') && !(item.source || '').includes('估值数据')),
      )
      return dedupeNews([...macroNews.value, ...fallback]).slice(0, 6)
    })
    const futureScenarios = computed(() => diagnosis.value?.scenarios?.slice(0, 4) ?? [])
    const catalystBullets = computed(() => {
      if (diagnosis.value?.catalysts?.length) return diagnosis.value.catalysts.slice(0, 5)
      return dedupeBullets([
        ...stockStimuli.value.map((item) => `公司消息：${item.title}`),
        ...macroStimuli.value.map((item) => `外部刺激：${item.title}`),
        currentQuote.value ? `价格位置：现价 ${formatPrice(currentQuote.value.price)}，关注 ${formatPrice(technical.value.supportPrice)} 一线承接。` : '',
      ])
    })
    const riskBullets = computed(() => {
      if (diagnosis.value?.risks?.length) return diagnosis.value.risks.slice(0, 5)
      return dedupeBullets([
        ...macroStimuli.value.map((item) => `消息扰动：${item.title}`),
        currentQuote.value ? `风控位：若跌破 ${formatPrice(technical.value.supportPrice)}，短线需及时收缩仓位。` : '',
      ])
    })
    const impactBullets = computed(() => {
      if (diagnosis.value?.socialSignals?.length) return diagnosis.value.socialSignals.slice(0, 5)
      return dedupeBullets([
        ...macroStimuli.value.map((item) => `${item.source || '市场消息'}：${item.summary || item.content || item.title}`),
        currentQuote.value ? `当前涨跌幅 ${formatPercent(currentQuote.value.changePercent)}%，需结合盘中量能确认持续性。` : '',
      ])
    })

    function handleSelectStock(item: StockQuote) {
      resolvedStockCode.value = item.code
      stockQuery.value = `${item.name} ${item.code}`
      currentStock.value = { name: item.name, code: item.code }
      void runQuery(item.code, item.name)
    }

    async function executeAnalysis(code: string, preferredName?: string, silent = false) {
      const targetCode = code.trim()
      if (!targetCode) return

      if (!silent) {
        loading.value = true
        analysisError.value = ''
        diagnosis.value = null
        currentQuote.value = null
        finance.value = {
          pe: 0,
          pb: 0,
          totalMv: 0,
          circMv: 0,
          roe: 0,
          eps: 0,
          bps: 0,
          turnover: 0,
        }
        stockNews.value = []
        macroNews.value = []
        policyEvidence.value = []
        klineData.value = []
      }
      diagnosisLoading.value = true

      try {
        const result = await runDiagnosisAgent({
          code: targetCode,
          provider: settingsStore.activeProvider,
          searchProviders: settingsStore.enabledSearchProviders,
          activeSearchProvider: settingsStore.activeSearchProvider,
          maxSteps: settingsStore.settings.ai.diagnosis.maxSteps,
          period: period.value,
          adjust: adjust.value,
          resolvedName: preferredName || currentStock.value?.name || '',
        })

        resolvedStockCode.value = result.stockInfo.code
        currentStock.value = {
          name: result.stockInfo.name || preferredName || targetCode,
          code: result.stockInfo.code,
        }
        stockQuery.value = `${currentStock.value.name} ${currentStock.value.code}`
        currentQuote.value = result.stockInfo
        finance.value = result.finance
        stockNews.value = result.stockNews
        macroNews.value = result.macroNews
        policyEvidence.value = result.policyEvidence
        diagnosis.value = result.diagnosis
        klineData.value = result.klineData.slice(-klineLimit.value)
        lastAnalysisAt.value = Date.now()

        if (!settingsStore.activeProvider) {
          analysisError.value = '当前未启用模型，已退回到本地规则诊股结论。'
        }
      } catch (error) {
        analysisError.value = error instanceof Error ? error.message : String(error)
      } finally {
        loading.value = false
        diagnosisLoading.value = false
      }
    }

    async function runQuery(explicitCode?: string, explicitName?: string) {
      const resolved = explicitCode
        ? { code: explicitCode, name: explicitName || currentStock.value?.name || explicitCode }
        : await resolveStockFromInput(stockQuery.value, marketStore.searchStock, marketStore.stockList)

      if (!resolved?.code) {
        analysisError.value = '未匹配到可分析的股票，请重新输入名称或代码。'
        return
      }

      await executeAnalysis(resolved.code, resolved.name)
    }

    function formatSyncTime(value: number) {
      return value ? new Date(value).toLocaleTimeString('zh-CN', { hour12: false }) : '--'
    }

    const realtimeTask = useRealtimeTask(async () => {
      if (!resolvedStockCode.value.trim() || !analysisAutoEnabled.value) return
      const now = Date.now()
      if (now - lastAnalysisAt.value < 90000) return
      await executeAnalysis(resolvedStockCode.value, currentStock.value?.name, true)
    }, { intervalMultiplier: 4, immediate: false, minimumMs: 20000, pauseWhenHidden: true })

    onMounted(async () => {
      if (!marketStore.stockList.length) {
        await marketStore.fetchStockList('a', 1, 80)
      }
      realtimeTask.start(false)
    })

    onActivated(() => {
      realtimeTask.start(false)
    })

    onDeactivated(() => {
      realtimeTask.stop()
    })

    watch([period, adjust, klineLimit], async () => {
      if (!resolvedStockCode.value.trim()) return
      await executeAnalysis(resolvedStockCode.value, currentStock.value?.name)
    })

    return {
      stockQuery,
      resolvedStockCode,
      period,
      adjust,
      klineLimit,
      loading,
      diagnosisLoading,
      analysisError,
      currentStock,
      currentQuote,
      finance,
      diagnosis,
      klineData,
      klineChartKey,
      summaryCards,
      diagnosisCards,
      stockStimuli,
      macroStimuli,
      futureScenarios,
      catalystBullets,
      riskBullets,
      impactBullets,
      profile,
      technical,
      analysisAutoEnabled,
      lastAnalysisAt,
      formatPrice,
      formatPercent,
      formatAmount,
      formatVolume,
      formatShortTime,
      formatSyncTime,
      runQuery,
      handleSelectStock,
    }
  },
})
