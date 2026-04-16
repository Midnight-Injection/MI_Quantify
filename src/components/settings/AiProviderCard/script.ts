import { computed, defineComponent, ref, type PropType } from 'vue'
import type { AiProvider, ProxyConfig } from '@/types'

export default defineComponent({
  name: 'AiProviderCard',
  props: {
    provider: { type: Object as PropType<AiProvider>, required: true },
    isActive: { type: Boolean, default: false },
    testing: { type: Boolean, default: false },
    testingResult: { type: String, default: '' },
    proxies: { type: Array as PropType<ProxyConfig[]>, default: () => [] },
  },
  emits: ['update', 'toggle-enabled', 'set-active', 'test'],
  setup(props) {
    const showKey = ref(false)
    const enabledProxies = computed(() => props.proxies.filter((p) => p.enabled))
    return { showKey, enabledProxies }
  },
})
