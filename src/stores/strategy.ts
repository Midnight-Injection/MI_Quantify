import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { Strategy, Signal, PromptTemplate, AiEvaluation } from '@/types'
import { BUILTIN_PROMPT_TEMPLATES, BUILTIN_STRATEGIES } from '@/utils/constants'

const STRATEGY_STORAGE_KEY = 'mi_quantify_strategy_state'

function mergeStrategiesWithBuiltins(storedStrategies: Strategy[]) {
  const builtinMap = new Map(BUILTIN_STRATEGIES.map((item) => [item.id, { ...item }]))
  const merged: Strategy[] = []

  for (const builtin of BUILTIN_STRATEGIES) {
    const stored = storedStrategies.find((item) => item.id === builtin.id)
    merged.push(stored ? { ...builtin, ...stored, builtin: true } : { ...builtin })
  }

  for (const item of storedStrategies) {
    if (!builtinMap.has(item.id)) {
      merged.push({ ...item, builtin: false })
    }
  }

  return merged
}

const MOCK_SIGNALS: Signal[] = [
  {
    id: 'sig_1',
    stockCode: '600519',
    stockName: '贵州茅台',
    strategyId: 'ma_cross',
    strategyName: '均线交叉策略',
    type: 'buy',
    strength: 'strong',
    price: 1688.0,
    reason: 'MACD金叉，RSI(14)回升至45，北向资金连续3日净流入，均线多头排列形成',
    timestamp: Date.now() - 300000,
  },
  {
    id: 'sig_2',
    stockCode: '000858',
    stockName: '五粮液',
    strategyId: 'rsi_extreme',
    strategyName: 'RSI超买超卖策略',
    type: 'buy',
    strength: 'medium',
    price: 142.35,
    reason: 'RSI从超卖区回升至35，成交量温和放大，短期存在反弹机会',
    timestamp: Date.now() - 600000,
  },
  {
    id: 'sig_3',
    stockCode: '300750',
    stockName: '宁德时代',
    strategyId: 'macd_divergence',
    strategyName: 'MACD背离策略',
    type: 'sell',
    strength: 'medium',
    price: 218.50,
    reason: 'MACD顶背离信号出现，成交量萎缩，短期上涨动能减弱',
    timestamp: Date.now() - 900000,
  },
  {
    id: 'sig_4',
    stockCode: '002594',
    stockName: '比亚迪',
    strategyId: 'ai_comprehensive',
    strategyName: 'AI综合评估策略',
    type: 'hold',
    strength: 'weak',
    price: 298.70,
    reason: '均线纠缠，方向不明，建议观望等待突破信号',
    timestamp: Date.now() - 1200000,
  },
  {
    id: 'sig_5',
    stockCode: '601318',
    stockName: '中国平安',
    strategyId: 'volume_breakout',
    strategyName: '放量突破策略',
    type: 'buy',
    strength: 'strong',
    price: 52.80,
    reason: '放量突破20日均线，主力资金大幅流入，技术面转多',
    timestamp: Date.now() - 1800000,
  },
]

export const useStrategyStore = defineStore('strategy', () => {
  const strategies = ref<Strategy[]>(loadStrategies())
  const signals = ref<Signal[]>(loadSignals())
  const promptTemplates = ref<PromptTemplate[]>(loadPromptTemplates())
  const evaluations = ref<AiEvaluation[]>(loadEvaluations())
  const loading = ref(false)

  function loadStrategies() {
    if (typeof localStorage === 'undefined') return [...BUILTIN_STRATEGIES]
    try {
      const raw = localStorage.getItem(STRATEGY_STORAGE_KEY)
      if (!raw) return [...BUILTIN_STRATEGIES]
      const parsed = JSON.parse(raw) as {
        strategies?: Strategy[]
      }
      if (!parsed.strategies?.length) return [...BUILTIN_STRATEGIES]
      return mergeStrategiesWithBuiltins(parsed.strategies)
    } catch {
      return [...BUILTIN_STRATEGIES]
    }
  }

  function loadPromptTemplates() {
    if (typeof localStorage === 'undefined') return [...BUILTIN_PROMPT_TEMPLATES]
    try {
      const raw = localStorage.getItem(STRATEGY_STORAGE_KEY)
      if (!raw) return [...BUILTIN_PROMPT_TEMPLATES]
      const parsed = JSON.parse(raw) as {
        promptTemplates?: PromptTemplate[]
      }
      return parsed.promptTemplates?.length ? parsed.promptTemplates : [...BUILTIN_PROMPT_TEMPLATES]
    } catch {
      return [...BUILTIN_PROMPT_TEMPLATES]
    }
  }

  function loadSignals() {
    if (typeof localStorage === 'undefined') return [...MOCK_SIGNALS]
    try {
      const raw = localStorage.getItem(STRATEGY_STORAGE_KEY)
      if (!raw) return [...MOCK_SIGNALS]
      const parsed = JSON.parse(raw) as {
        signals?: Signal[]
      }
      return parsed.signals?.length ? parsed.signals : [...MOCK_SIGNALS]
    } catch {
      return [...MOCK_SIGNALS]
    }
  }

  function loadEvaluations() {
    if (typeof localStorage === 'undefined') return []
    try {
      const raw = localStorage.getItem(STRATEGY_STORAGE_KEY)
      if (!raw) return []
      const parsed = JSON.parse(raw) as {
        evaluations?: AiEvaluation[]
      }
      return parsed.evaluations?.length ? parsed.evaluations : []
    } catch {
      return []
    }
  }

  function persist() {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(
      STRATEGY_STORAGE_KEY,
      JSON.stringify({
        strategies: strategies.value,
        signals: signals.value.slice(0, 50),
        promptTemplates: promptTemplates.value,
        evaluations: evaluations.value.slice(0, 30),
      }),
    )
  }

  function toggleStrategy(id: string, enabled: boolean) {
    const idx = strategies.value.findIndex((s) => s.id === id)
    if (idx !== -1) {
      strategies.value[idx] = { ...strategies.value[idx], enabled, updatedAt: Date.now() }
      persist()
    }
  }

  function updatePromptTemplate(id: string, content: string) {
    const idx = promptTemplates.value.findIndex((t) => t.id === id)
    if (idx !== -1) {
      promptTemplates.value[idx] = { ...promptTemplates.value[idx], content }
      persist()
    }
  }

  function resetPromptTemplate(id: string) {
    const builtin = BUILTIN_PROMPT_TEMPLATES.find((t) => t.id === id)
    if (builtin) {
      const idx = promptTemplates.value.findIndex((t) => t.id === id)
      if (idx !== -1) {
        promptTemplates.value[idx] = { ...builtin }
        persist()
      }
    }
  }

  function appendEvaluation(evaluation: AiEvaluation) {
    evaluations.value.unshift(evaluation)
    evaluations.value = evaluations.value.slice(0, 30)
    persist()
  }

  function prependSignal(signal: Signal) {
    signals.value.unshift(signal)
    signals.value = signals.value.slice(0, 50)
    persist()
  }

  function upsertCustomStrategy(strategy: Omit<Strategy, 'builtin'> & { builtin?: boolean }) {
    const record: Strategy = {
      ...strategy,
      builtin: false,
      updatedAt: Date.now(),
    }
    const idx = strategies.value.findIndex((item) => item.id === record.id)
    if (idx === -1) {
      strategies.value.unshift(record)
    } else {
      strategies.value[idx] = {
        ...strategies.value[idx],
        ...record,
      }
    }
    persist()
  }

  function removeStrategy(id: string) {
    const target = strategies.value.find((item) => item.id === id)
    if (!target || target.builtin) return
    strategies.value = strategies.value.filter((item) => item.id !== id)
    persist()
  }

  return {
    strategies,
    signals,
    promptTemplates,
    evaluations,
    loading,
    toggleStrategy,
    updatePromptTemplate,
    addPromptTemplate(template: PromptTemplate) {
      promptTemplates.value.push(template)
      persist()
    },
    resetPromptTemplate,
    appendEvaluation,
    prependSignal,
    upsertCustomStrategy,
    removeStrategy,
  }
})
