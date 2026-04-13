import { defineComponent, type PropType } from 'vue'

export interface IndicatorItem {
  label: string
  value: string
  colorClass?: string
}

export default defineComponent({
  name: 'IndicatorPanel',
  props: {
    indicators: { type: Array as PropType<IndicatorItem[]>, default: () => [] },
  },
})
