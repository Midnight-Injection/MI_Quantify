import { defineComponent, ref, type PropType } from 'vue'
import type { AiProvider } from '@/types'

export default defineComponent({
  name: 'AiProviderCard',
  props: {
    provider: { type: Object as PropType<AiProvider>, required: true },
    isActive: { type: Boolean, default: false },
    testing: { type: Boolean, default: false },
    testingResult: { type: String, default: '' },
  },
  emits: ['update', 'toggle-enabled', 'set-active', 'test'],
  setup() {
    const showKey = ref(false)
    return { showKey }
  },
})
