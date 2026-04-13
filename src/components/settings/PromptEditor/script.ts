import { defineComponent, ref, computed, type PropType } from 'vue'
import type { PromptTemplate, PromptCategory } from '@/types'

const CATEGORIES: Array<{ key: string; label: string }> = [
  { key: 'daily_eval', label: '每日评估' },
  { key: 'buy_signal', label: '买入信号' },
  { key: 'sell_signal', label: '卖出信号' },
  { key: 'news_analysis', label: '新闻分析' },
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
