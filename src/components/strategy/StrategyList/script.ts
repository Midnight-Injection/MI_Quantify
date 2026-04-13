import { defineComponent, type PropType } from 'vue'
import type { Strategy, StrategyCategory } from '@/types'

export default defineComponent({
  name: 'StrategyList',
  props: {
    strategies: { type: Array as PropType<Strategy[]>, default: () => [] },
  },
  emits: ['toggle', 'remove'],
  setup() {
    function categoryLabel(c: StrategyCategory) {
      const map: Record<string, string> = {
        trend: '趋势', mean_reversion: '均值回归', momentum: '动量',
        volume: '成交量', pattern: '形态', fundamental: '基本面', ai: 'AI',
      }
      return map[c] || c
    }
    function categoryTag(c: StrategyCategory) {
      const map: Record<string, string> = {
        trend: 'tag-positive', momentum: 'tag-positive',
        mean_reversion: 'tag-neutral', volume: 'tag-neutral',
        ai: 'tag-info', fundamental: 'tag-info',
      }
      return map[c] || 'tag-neutral'
    }
    return { categoryLabel, categoryTag }
  },
})
