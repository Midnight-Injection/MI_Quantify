import { defineComponent, ref } from 'vue'
import type { AiDiagnosis, AiEvaluation, Signal, SignalStrength, SignalType, StockQuote } from '@/types'
import { useStrategyStore } from '@/stores/strategy'
import { useSettingsStore } from '@/stores/settings'
import { useMarketStore } from '@/stores/market'
import { runDiagnosisAgent } from '@/agents/diagnosisAgent'
import { resolveStockCodeFromInput } from '@/utils/aiQuestion'
import { formatPrice } from '@/utils/format'
import StockSearchInput from '@/components/common/StockSearchInput/index.vue'

export default defineComponent({
  name: 'AiEvaluator',
  components: { StockSearchInput },
  setup() {
    const strategyStore = useStrategyStore()
    const settingsStore = useSettingsStore()
    const marketStore = useMarketStore()
    const stockQuery = ref('')
    const stockCode = ref('')
    const stockName = ref('')
    const result = ref<AiEvaluation | null>(null)
    const diagnosis = ref<AiDiagnosis | null>(null)
    const loading = ref(false)
    const error = ref('')

    function handleSelectStock(item: StockQuote) {
      stockCode.value = item.code
      stockName.value = item.name
      stockQuery.value = `${item.name} ${item.code}`
    }

    async function handleEvaluate(keywordFromInput?: string) {
      const code = await resolveStockCodeFromInput(
        keywordFromInput || stockQuery.value || stockCode.value,
        marketStore.searchStock,
        marketStore.stockList,
      )
      if (!code) return
      stockCode.value = code
      error.value = ''
      loading.value = true
      try {
        const agentResult = await runDiagnosisAgent({
          code: stockCode.value.trim(),
          provider: settingsStore.activeProvider,
          searchProviders: settingsStore.enabledSearchProviders,
          activeSearchProvider: settingsStore.activeSearchProvider,
          maxSteps: settingsStore.settings.ai.diagnosis.maxSteps,
        })
        diagnosis.value = agentResult.diagnosis
        result.value = {
          id: `eval_${Date.now()}`,
          stockCode: agentResult.stockInfo.code,
          stockName: stockName.value.trim() || agentResult.stockInfo.name,
          technicalScore: agentResult.technical.trend === 'bullish' ? 8 : agentResult.technical.trend === 'bearish' ? 4 : 6,
          sentimentScore: Math.min(10, Math.max(1, Math.round(agentResult.diagnosis.confidence / 12))),
          fundScore: agentResult.diagnosis.recommendation.includes('观望') ? 4 : 7,
          totalScore: Math.min(10, Math.max(1, Math.round(agentResult.diagnosis.confidence / 10))),
          recommendation: agentResult.diagnosis.recommendation,
          prediction: agentResult.diagnosis.prediction,
          supportPrice: agentResult.diagnosis.supportPrice,
          resistancePrice: agentResult.diagnosis.resistancePrice,
          reason: agentResult.diagnosis.summary,
          timestamp: Date.now(),
        }
        strategyStore.appendEvaluation(result.value)
        stockName.value = agentResult.stockInfo.name
        stockQuery.value = `${agentResult.stockInfo.name} ${agentResult.stockInfo.code}`
        const type: SignalType = agentResult.diagnosis.recommendation.includes('卖')
          ? 'sell'
          : agentResult.diagnosis.recommendation.includes('观望')
            ? 'hold'
            : 'buy'
        const strength: SignalStrength = agentResult.diagnosis.confidence >= 72
          ? 'strong'
          : agentResult.diagnosis.confidence >= 55
            ? 'medium'
            : 'weak'
        const signal: Signal = {
          id: `sig_${Date.now()}`,
          stockCode: agentResult.stockInfo.code,
          stockName: stockName.value.trim() || agentResult.stockInfo.name,
          strategyId: 'ai_comprehensive',
          strategyName: 'AI综合评估策略',
          type,
          strength,
          price: agentResult.stockInfo.price,
          targetPrice: agentResult.diagnosis.takeProfitPrice,
          stopLoss: agentResult.diagnosis.stopLossPrice,
          reason: agentResult.diagnosis.summary,
          timestamp: Date.now(),
        }
        strategyStore.prependSignal(signal)
      } catch (err) {
        error.value = err instanceof Error ? err.message : String(err)
      } finally {
        loading.value = false
      }
    }

    function scoreClass(score: number) {
      if (score >= 7) return 'high'
      if (score >= 4) return 'mid'
      return 'low'
    }

    function recClass(rec: string) {
      if (rec.includes('买入') || rec.includes('buy')) return 'rec-buy'
      if (rec.includes('卖出') || rec.includes('sell')) return 'rec-sell'
      return 'rec-hold'
    }

    function recText(rec: string) {
      return rec
    }

    return {
      stockQuery,
      stockCode,
      stockName,
      result,
      diagnosis,
      loading,
      error,
      formatPrice,
      handleEvaluate,
      handleSelectStock,
      scoreClass,
      recClass,
      recText,
    }
  },
})
