import { defineComponent, type PropType } from 'vue'
import type { Signal } from '@/types'
import { formatTime } from '@/utils/format'

export default defineComponent({
  name: 'SignalList',
  props: {
    signals: { type: Array as PropType<Signal[]>, default: () => [] },
  },
  setup() {
    return { formatTime }
  },
})
