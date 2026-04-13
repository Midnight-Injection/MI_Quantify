import { defineComponent, type PropType } from 'vue'
import type { StockQuote } from '@/types'
import { formatPrice, formatPercent, formatVolume, formatAmount } from '@/utils/format'

export default defineComponent({
  name: 'WatchListTable',
  props: {
    quotes: { type: Array as PropType<StockQuote[]>, default: () => [] },
  },
  emits: ['select', 'remove'],
  setup() {
    return { formatPrice, formatPercent, formatVolume, formatAmount }
  },
})
