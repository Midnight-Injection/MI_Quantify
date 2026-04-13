import { computed, defineComponent, reactive } from 'vue'
import { useStrategyStore } from '@/stores/strategy'
import { formatTime } from '@/utils/format'
import StrategyList from '@/components/strategy/StrategyList/index.vue'
import AiEvaluator from '@/components/strategy/AiEvaluator/index.vue'
import SignalList from '@/components/strategy/SignalList/index.vue'
import type { StrategyCategory } from '@/types'

export default defineComponent({
  name: 'StrategyView',
  components: { StrategyList, AiEvaluator, SignalList },
  setup() {
    const strategyStore = useStrategyStore()
    const categoryLabelMap: Record<StrategyCategory, string> = {
      trend: '趋势',
      mean_reversion: '均值回归',
      momentum: '动量',
      volume: '成交量',
      pattern: '形态',
      fundamental: '基本面',
      ai: 'AI',
    }
    const customStrategy = reactive({
      id: '',
      name: '',
      description: '',
      category: 'ai' as StrategyCategory,
      enabled: true,
      notes: '',
    })

    const categoryOptions: Array<{ value: StrategyCategory; label: string }> = [
      { value: 'trend', label: '趋势' },
      { value: 'mean_reversion', label: '均值回归' },
      { value: 'momentum', label: '动量' },
      { value: 'volume', label: '成交量' },
      { value: 'pattern', label: '形态' },
      { value: 'fundamental', label: '基本面' },
      { value: 'ai', label: 'AI' },
    ]

    const strategyStats = computed(() => {
      const enabled = strategyStore.strategies.filter((item) => item.enabled).length
      const builtin = strategyStore.strategies.filter((item) => item.builtin).length
      const aiDriven = strategyStore.strategies.filter((item) => item.category === 'ai').length
      const strongSignals = strategyStore.signals.filter((item) => item.strength === 'strong').length
      return [
        { label: '已启用策略', value: enabled, detail: '当前会参与信号判断的策略数' },
        { label: '专业框架', value: builtin, detail: '内置专业交易策略与事件框架' },
        { label: 'AI策略', value: aiDriven, detail: '结合消息、资金和多因子的策略' },
        { label: '强信号', value: strongSignals, detail: '最近一批高强度交易信号' },
      ]
    })

    const categoryBreakdown = computed(() =>
      categoryOptions.map((item) => ({
        label: item.label,
        count: strategyStore.strategies.filter((strategy) => strategy.category === item.value).length,
      })).filter((item) => item.count > 0),
    )

    const featuredStrategies = computed(() =>
      strategyStore.strategies
        .filter((item) => item.builtin)
        .slice(0, 8)
        .map((item) => ({
          id: item.id,
          name: item.name,
          category: categoryLabelMap[item.category],
          summary: item.notes || item.description,
        })),
    )

    const researchGuides = [
      {
        title: '趋势确认',
        metric: 'ADX / 均线',
        description: '用来判断趋势是否够清晰，只有趋势够强时，突破和跟随策略才更有效。',
        range: 'ADX 25 以上更像趋势，20 以下更像震荡。',
      },
      {
        title: '超买超卖',
        metric: 'RSI / 布林带',
        description: '用来判断价格是否短线偏离太远，适合抓回踩修复或高位降速。',
        range: 'RSI 30 附近偏低位，70 以上偏高位；靠近布林下轨更适合等止跌。',
      },
      {
        title: '突破真假',
        metric: '量比 / ATR / Donchian',
        description: '用来判断新高或新低是不是有资金和波动配合，避免被假突破骗线。',
        range: '量比 1.5 以上更有说服力，ATR 低位回升说明波动开始放大。',
      },
      {
        title: '主线延续',
        metric: '相对强弱 / 板块排名',
        description: '用来判断个股是不是持续强于指数和板块，帮助优先盯核心龙头。',
        range: '连续强于指数且板块排名靠前，延续性通常更好。',
      },
    ]

    const evaluationSummary = computed(() => {
      if (!strategyStore.evaluations.length) {
        return {
          avgScore: '--',
          latest: '暂无评估',
          actionBias: '等待更多样本',
        }
      }
      const topTen = strategyStore.evaluations.slice(0, 10)
      const avgScore = (topTen.reduce((sum, item) => sum + item.totalScore, 0) / topTen.length).toFixed(1)
      const latest = `${topTen[0].stockName} ${topTen[0].recommendation}`
      const buyCount = topTen.filter((item) => item.recommendation.includes('买')).length
      const sellCount = topTen.filter((item) => item.recommendation.includes('卖')).length
      return {
        avgScore,
        latest,
        actionBias: buyCount >= sellCount ? '当前偏进攻' : '当前偏防守',
      }
    })

    function saveCustomStrategy() {
      if (!customStrategy.name.trim() || !customStrategy.description.trim()) return
      const id = customStrategy.id.trim() || `custom_${Date.now()}`
      strategyStore.upsertCustomStrategy({
        id,
        name: customStrategy.name.trim(),
        description: customStrategy.description.trim(),
        category: customStrategy.category,
        enabled: customStrategy.enabled,
        params: {
          notes: customStrategy.notes.trim(),
        },
        notes: customStrategy.notes.trim(),
      })
      customStrategy.id = ''
      customStrategy.name = ''
      customStrategy.description = ''
      customStrategy.category = 'ai'
      customStrategy.enabled = true
      customStrategy.notes = ''
    }

    return {
      strategyStore,
      formatTime,
      customStrategy,
      categoryOptions,
      strategyStats,
      categoryBreakdown,
      featuredStrategies,
      researchGuides,
      evaluationSummary,
      saveCustomStrategy,
    }
  },
})
