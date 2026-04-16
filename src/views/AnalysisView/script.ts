import { computed, defineComponent, onActivated, onDeactivated, onMounted, ref } from 'vue'
import type { AiDiagnosis, DiagnosisEvidence, KlineData, StockQuote, Strategy } from '@/types'
import { useSettingsStore } from '@/stores/settings'
import { useMarketStore } from '@/stores/market'
import { useStrategyStore } from '@/stores/strategy'
import { useRealtimeTask } from '@/composables/useRealtimeTask'
import { useAiTaskLogger } from '@/composables/useAiTaskLogger'
import { buildTechnicalSnapshot, getStockProfile } from '@/utils/marketMetrics'
import { resolveStockFromInput } from '@/utils/aiQuestion'
import { formatAmount, formatPercent, formatPrice, formatVolume } from '@/utils/format'
import { getMarketSessionContext } from '@/utils/marketSession'
import {
  runDiagnosisAgent,
  type DiagnosisAgentPartialResult,
  type DiagnosisFinanceInfo,
  type DiagnosisNewsItem,
  type DiagnosisStockInfo,
} from '@/agents/diagnosisAgent'
import StockSearchInput from '@/components/common/StockSearchInput/index.vue'
import type { MarketCode } from '@/utils/marketSession'

function formatShortTime(value?: string) {
  if (!value) return '--'
  return value.slice(5, 16)
}

export default defineComponent({
  name: 'AnalysisView',
  components: { StockSearchInput },
  setup() {
    const settingsStore = useSettingsStore()
    const marketStore = useMarketStore()
    const strategyStore = useStrategyStore()
    const aiTaskLogger = useAiTaskLogger()
    const stockQuery = ref('')
    const resolvedStockCode = ref('')
    const period = ref('daily')
    const adjust = ref('qfq')
    const klineLimit = ref(120)
    const selectedStrategyId = ref('ai_comprehensive')
    const loading = ref(false)
    const diagnosisLoading = ref(false)
    const analysisError = ref('')
    const lastAnalysisAt = ref(0)
    const analysisTaskId = ref<string | null>(null)

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

    function applyPartialResult(partial: DiagnosisAgentPartialResult, preferredName?: string) {
      if (partial.stockInfo?.code) {
        resolvedStockCode.value = partial.stockInfo.code
        currentStock.value = {
          name: partial.stockInfo.name || preferredName || partial.stockInfo.code,
          code: partial.stockInfo.code,
        }
        stockQuery.value = `${currentStock.value.name} ${currentStock.value.code}`
        currentQuote.value = partial.stockInfo
      }

      finance.value = partial.finance
      if (partial.stockNews.length) {
        stockNews.value = partial.stockNews
      }
      if (partial.macroNews.length) {
        macroNews.value = partial.macroNews
      }
      if (partial.klineData.length) {
        klineData.value = partial.klineData.slice(-klineLimit.value)
      }
    }

    function formatRange(lower?: number, upper?: number) {
      if (typeof lower === 'number' && typeof upper === 'number') {
        return `${formatPrice(lower)} - ${formatPrice(upper)}`
      }
      return '--'
    }

    function buildLocalFallbackDiagnosis(stockInfo: DiagnosisStockInfo, partial: DiagnosisAgentPartialResult): AiDiagnosis {
      const technicalSnapshot = buildTechnicalSnapshot(partial.klineData)
      const support = technicalSnapshot.supportPrice || Number((stockInfo.price * 0.97).toFixed(2))
      const resistance = technicalSnapshot.resistancePrice || Number((stockInfo.price * 1.04).toFixed(2))
      const prediction = technicalSnapshot.trend === 'bullish'
        ? '看多'
        : technicalSnapshot.trend === 'bearish'
          ? '看空'
          : '震荡'
      const recommendation = prediction === '看多' ? '买入' : prediction === '看空' ? '卖出' : '观望'
      const session = getMarketSessionContext(realtimeMarket.value)
      const phaseSummary = session.phase === 'trading'
        ? '当前处于盘中阶段，结论以当下量价和承接为准。'
        : session.phase === 'post_market'
          ? '当前处于盘后阶段，结论以下一交易日执行计划为准。'
          : '当前处于非连续交易阶段，结论以下一次开盘确认信号为准。'
      const catalysts = dedupeBullets(partial.stockNews.slice(0, 5).map((item) => `公司消息：${item.title}`), 5)
      const risks = dedupeBullets([
        ...partial.macroNews.slice(0, 3).map((item) => `外部扰动：${item.title}`),
        `风控位：跌破 ${formatPrice(support)} 需要收缩仓位。`,
      ], 5)
      const impacts = dedupeBullets([
        ...partial.macroNews.slice(0, 3).map((item) => `${item.source || '市场消息'}：${item.summary || item.content || item.title}`),
        `技术位置：当前关注 ${formatPrice(support)} 支撑与 ${formatPrice(resistance)} 压力。`,
      ], 5)
      const lotSize = getStockProfile(stockInfo.code).lotSize

      return {
        recommendation,
        prediction,
        confidence: prediction === '震荡' ? 52 : 60,
        riskLevel: technicalSnapshot.momentum === 'weak' ? '高' : '中',
        summary: `${phaseSummary}${prediction === '看多' ? `短线先看 ${formatPrice(support)} 上方承接，若放量突破 ${formatPrice(resistance)}，走势仍有延续空间。` : prediction === '看空' ? `短线先看 ${formatPrice(resistance)} 一带反压，若继续失守 ${formatPrice(support)}，节奏仍偏弱。` : `短线更像区间震荡，先看 ${formatPrice(support)} - ${formatPrice(resistance)} 的区间选择。`}`,
        supportPrice: support,
        resistancePrice: resistance,
        buyLower: support,
        buyUpper: Number((support * 1.01).toFixed(2)),
        sellLower: Number((resistance * 0.985).toFixed(2)),
        sellUpper: resistance,
        positionAdvice: recommendation === '买入' ? '先用轻仓试探，确认承接后再逐步加到中仓。' : '以轻仓观察为主，优先等确认信号后再动作。',
        positionSize: recommendation === '买入' ? '轻仓到中仓' : '轻仓',
        entryAdvice: `优先观察 ${formatPrice(support)} 附近承接，只有回踩不破并重新放量时再考虑介入。`,
        exitAdvice: `若反弹至 ${formatPrice(resistance)} 一带但量能跟不上，分批兑现；若直接跌破 ${formatPrice(support)}，先止损。`,
        stopLossPrice: Number((support * 0.97).toFixed(2)),
        takeProfitPrice: resistance,
        suggestedShares: Math.max(100, lotSize),
        catalysts,
        risks,
        socialSignals: impacts,
        scenarios: [
          { label: '1日情景', expectedPrice: stockInfo.price, probabilityHint: '先看最近一个交易日的承接和量能变化。' },
          { label: '5日情景', expectedPrice: Number(((stockInfo.price + resistance) / 2).toFixed(2)), probabilityHint: '未来 3-5 个交易日关注是否向压力位推进。' },
          { label: '20日情景', expectedPrice: resistance, probabilityHint: '中短周期关注区间突破后的延续性。' },
        ],
        evidence: [
          {
            title: `${stockInfo.name} 实时盘口`,
            summary: `现价 ${formatPrice(stockInfo.price)}，涨跌幅 ${formatPercent(stockInfo.changePercent)}%，换手 ${formatPercent(stockInfo.turnover)}%。`,
            source: '实时行情',
            tone: stockInfo.changePercent >= 0 ? 'positive' : 'negative',
          },
          ...partial.stockNews.slice(0, 4).map((item) => ({
            title: item.title,
            summary: item.summary || item.content || item.title,
            source: item.source || '个股消息',
            tone: 'neutral' as const,
          })),
          ...partial.macroNews.slice(0, 3).map((item) => ({
            title: item.title,
            summary: item.summary || item.content || item.title,
            source: item.source || '市场消息',
            tone: 'neutral' as const,
          })),
        ],
        generatedAt: Date.now(),
      }
    }

    const technical = computed(() => buildTechnicalSnapshot(klineData.value))
    const profile = computed(() => getStockProfile(resolvedStockCode.value.trim()))
    const realtimeMarket = computed<MarketCode>(() => {
      if (profile.value.market === 'hk') return 'hk'
      if (profile.value.market === 'us') return 'us'
      return 'a'
    })
    const isTradingSession = computed(() => getMarketSessionContext(realtimeMarket.value).phase === 'trading')
    const analysisAutoEnabled = computed(() => settingsStore.settings.ai.autoRun.analysisDigest)
    const strategyOptions = computed(() =>
      [...strategyStore.strategies].sort(
        (a, b) => Number(b.enabled) - Number(a.enabled) || Number(b.builtin) - Number(a.builtin) || a.name.localeCompare(b.name),
      ),
    )
    const selectedStrategy = computed<Strategy | null>(() =>
      strategyOptions.value.find((item) => item.id === selectedStrategyId.value) ?? null,
    )
    const klineChartKey = computed(
      () => `${resolvedStockCode.value}_${period.value}_${adjust.value}_${klineLimit.value}_${klineData.value.length}_${klineData.value[0]?.timestamp || 0}`,
    )

    function ensureSelectedStrategy() {
      if (strategyOptions.value.some((item) => item.id === selectedStrategyId.value)) return
      selectedStrategyId.value = strategyOptions.value.find((item) => item.id === 'ai_comprehensive')?.id
        || strategyOptions.value.find((item) => item.enabled)?.id
        || strategyOptions.value[0]?.id
        || ''
    }

    function hydrateAnalysisFromCache(targetCode: string, preferredName?: string, selectedQuote?: StockQuote | null) {
      const cachedQuote = selectedQuote || marketStore.quotes.get(targetCode)
      const cachedListItem = marketStore.stockList.find((item) => item.code === targetCode)
      const fallbackName = preferredName || cachedQuote?.name || cachedListItem?.name || targetCode

      currentStock.value = {
        code: targetCode,
        name: fallbackName,
      }
      stockQuery.value = `${fallbackName} ${targetCode}`
      resolvedStockCode.value = targetCode

      if (cachedQuote || cachedListItem) {
        const snapshot = cachedQuote || cachedListItem
        currentQuote.value = {
          code: targetCode,
          name: snapshot?.name || fallbackName,
          price: snapshot?.price || 0,
          open: snapshot?.open || 0,
          high: snapshot?.high || 0,
          low: snapshot?.low || 0,
          preClose: snapshot?.preClose || 0,
          change: snapshot?.change || 0,
          changePercent: snapshot?.changePercent || 0,
          volume: snapshot?.volume || 0,
          amount: snapshot?.amount || 0,
          turnover: snapshot?.turnover || 0,
          date: currentQuote.value?.code === targetCode ? currentQuote.value.date : '',
          time: currentQuote.value?.code === targetCode ? currentQuote.value.time : '',
          bids: currentQuote.value?.code === targetCode ? currentQuote.value.bids : [],
          asks: currentQuote.value?.code === targetCode ? currentQuote.value.asks : [],
        }
      } else {
        currentQuote.value = null
      }

      if (cachedListItem) {
        finance.value = {
          ...finance.value,
          turnover: cachedListItem.turnover,
          pe: cachedListItem.pe ?? finance.value.pe,
          pb: cachedListItem.pb ?? finance.value.pb,
          totalMv: cachedListItem.totalMv ?? finance.value.totalMv,
          circMv: cachedListItem.circMv ?? finance.value.circMv,
        }
      }
    }

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
      hydrateAnalysisFromCache(item.code, item.name, item)
      if (analysisAutoEnabled.value) {
        void runQuery(item.code, item.name)
      } else {
        analysisError.value = ''
      }
    }

    async function executeAnalysis(code: string, preferredName?: string, silent = false) {
      const targetCode = code.trim()
      if (!targetCode) return
      const analysisTimeoutMs = 690_000

      const task = silent ? null : aiTaskLogger.createTask(`AI评估 ${preferredName || targetCode}`, 'analysis')
      analysisTaskId.value = task?.id ?? null

      if (!silent) {
        loading.value = true
        analysisError.value = ''
        diagnosis.value = null
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
        hydrateAnalysisFromCache(targetCode, preferredName)
        aiTaskLogger.addLog(task!.id, `开始分析 ${preferredName || targetCode}...`)
      }
      diagnosisLoading.value = true
      let latestPartial: DiagnosisAgentPartialResult = {
        stockInfo: null,
        finance: {
          pe: 0,
          pb: 0,
          totalMv: 0,
          circMv: 0,
          roe: 0,
          eps: 0,
          bps: 0,
          turnover: 0,
        },
        klineData: [],
        stockNews: [],
        macroNews: [],
        financeReport: null,
      }
      let timeoutId: ReturnType<typeof setTimeout> | null = null

      try {
        if (task) aiTaskLogger.addLog(task.id, '正在获取行情与K线数据...')

        const analysisPromise = runDiagnosisAgent({
          code: targetCode,
          provider: settingsStore.activeProvider,
          searchProviders: settingsStore.enabledSearchProviders,
          activeSearchProvider: settingsStore.activeSearchProvider,
          maxSteps: settingsStore.settings.ai.diagnosis.maxSteps,
          period: period.value,
          adjust: adjust.value,
          selectedStrategy: selectedStrategy.value,
          resolvedName: preferredName || currentStock.value?.name || '',
          abortSignal: task?.abortController?.signal,
          onProgress: (event) => {
            if (!task) return
            aiTaskLogger.addProgressLog(task.id, event.step)
          },
          onPartial: (partial) => {
            latestPartial = partial
            applyPartialResult(partial, preferredName)
          },
        })
        const timeoutPromise = new Promise<never>((_, reject) => {
          timeoutId = setTimeout(() => {
            task?.abortController?.abort()
            reject(new Error('ANALYSIS_TIMEOUT'))
          }, analysisTimeoutMs)
        })
        const result = await Promise.race([analysisPromise, timeoutPromise])

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

        if (task) {
          if (aiTaskLogger.isTaskCancelled(task.id)) {
            aiTaskLogger.addLog(task.id, '评估已被取消', 'warn')
          } else {
            if (result.llmSummary.fallback) {
              aiTaskLogger.addLog(task.id, result.llmSummary.notice, 'warn')
            } else {
              aiTaskLogger.addLog(task.id, `AI评估完成，建议：${result.diagnosis?.recommendation || '待确认'}`, 'success')
            }
            aiTaskLogger.completeTask(task.id, true)
          }
        }

        if (result.llmSummary.fallback) {
          analysisError.value = result.llmSummary.notice
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        if (msg === 'ANALYSIS_TIMEOUT' && (latestPartial.stockInfo || currentQuote.value)) {
          const fallbackStock = latestPartial.stockInfo || currentQuote.value
          if (fallbackStock) {
            diagnosis.value = buildLocalFallbackDiagnosis(fallbackStock, latestPartial)
            if (!currentQuote.value) {
              currentQuote.value = fallbackStock
            }
            lastAnalysisAt.value = Date.now()
            analysisError.value = 'AI 汇总超时，已使用本地规则完成当前诊股结论。'
            if (task && !aiTaskLogger.isTaskCancelled(task.id)) {
              aiTaskLogger.addLog(task.id, 'AI 汇总超时，已使用本地规则完成当前诊股结论。', 'warn')
              aiTaskLogger.completeTask(task.id, true)
            }
            return
          }
        }
        if (task) {
          if (aiTaskLogger.isTaskCancelled(task.id)) {
            aiTaskLogger.addLog(task.id, '评估已被取消', 'warn')
            analysisError.value = ''
            return
          } else {
            aiTaskLogger.addLog(task.id, `评估失败：${msg}`, 'error')
            aiTaskLogger.completeTask(task.id, false, msg)
          }
        }
        analysisError.value = msg
      } finally {
        if (timeoutId) clearTimeout(timeoutId)
        loading.value = false
        diagnosisLoading.value = false
        analysisTaskId.value = null
      }
    }

    function cancelAnalysis() {
      if (analysisTaskId.value) {
        aiTaskLogger.cancelTask(analysisTaskId.value)
        loading.value = false
        diagnosisLoading.value = false
        analysisError.value = ''
        analysisTaskId.value = null
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

    const analysisRealtime = useRealtimeTask(async () => {
      if (!isTradingSession.value) return
      if (!analysisAutoEnabled.value) return
      const targetCode = resolvedStockCode.value || currentStock.value?.code || ''
      if (!targetCode || diagnosisLoading.value || loading.value) return
      const now = Date.now()
      if (now - lastAnalysisAt.value < settingsStore.settings.ai.autoRunInterval * 1000) return
      await executeAnalysis(targetCode, currentStock.value?.name, true)
    }, {
      enabled: () => analysisAutoEnabled.value,
      immediate: false,
      intervalSource: 'ai',
      intervalMultiplier: 1,
      minimumMs: 10000,
      pauseWhenHidden: true,
      market: () => realtimeMarket.value,
      skipWhenMarketClosed: true,
    })

    onMounted(async () => {
      if (!marketStore.stockList.length) {
        void marketStore.fetchStockList('a', 1, 80)
      }
      ensureSelectedStrategy()
      analysisRealtime.start(false)
    })

    onActivated(() => {
      analysisRealtime.start(false)
    })

    onDeactivated(() => {
      analysisRealtime.stop()
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
      selectedStrategyId,
      selectedStrategy,
      strategyOptions,
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
      formatRange,
      runQuery,
      handleSelectStock,
      cancelAnalysis,
    }
  },
})
