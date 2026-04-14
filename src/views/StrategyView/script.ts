import { computed, defineComponent, reactive } from 'vue'
import { useStrategyStore } from '@/stores/strategy'
import StrategyList from '@/components/strategy/StrategyList/index.vue'
import PromptEditor from '@/components/settings/PromptEditor/index.vue'
import type { StrategyCategory } from '@/types'

export default defineComponent({
  name: 'StrategyView',
  components: { StrategyList, PromptEditor },
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

    function handleUpdatePrompt(id: string, content: string) {
      strategyStore.updatePromptTemplate(id, content)
    }

    function handleResetPrompt(id: string) {
      strategyStore.resetPromptTemplate(id)
    }

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
      customStrategy,
      categoryOptions,
      categoryBreakdown,
      featuredStrategies,
      handleUpdatePrompt,
      handleResetPrompt,
      saveCustomStrategy,
    }
  },
})
