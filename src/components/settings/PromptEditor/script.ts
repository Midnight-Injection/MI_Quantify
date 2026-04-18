import { defineComponent, ref, computed, type PropType } from 'vue'
import type { PromptTemplate, PromptCategory } from '@/types'

const CATEGORIES: Array<{ key: string; label: string }> = [
  { key: 'daily_eval', label: '每日评估' },
  { key: 'buy_signal', label: '买入信号' },
  { key: 'sell_signal', label: '卖出信号' },
  { key: 'news_analysis', label: '新闻分析' },
  { key: 'mode_router', label: '模式路由' },
  { key: 'recommendation_agent', label: '荐股智能体' },
  { key: 'investment_agent', label: '投资智能体' },
  { key: 'investment_synthesis', label: '投资总结' },
  { key: 'tool_retry_policy', label: '工具重试' },
  { key: 'custom', label: '自定义' },
]

export default defineComponent({
  name: 'PromptEditor',
  props: {
    templates: { type: Array as PropType<PromptTemplate[]>, required: true },
  },
  emits: ['update', 'reset'],
  setup(props) {
    const activeCategory = ref('daily_eval')

    const filteredTemplates = computed(() => {
      return props.templates.filter((t) => t.category === activeCategory.value)
    })

    return { activeCategory, categories: CATEGORIES, filteredTemplates }
  },
})
