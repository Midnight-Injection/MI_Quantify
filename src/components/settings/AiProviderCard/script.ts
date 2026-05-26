import { computed, defineComponent, reactive, ref, watch, type PropType } from 'vue'
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
  emits: ['update', 'toggle-enabled', 'set-active', 'test', 'remove'],
  setup(props, { emit }) {
    const showKey = ref(false)
    const expanded = ref(false)
    const formTouched = ref(false)
    const enabledProxies = computed(() => props.proxies.filter((p) => p.enabled))

    const form = reactive({
      name: props.provider.name,
      apiUrl: props.provider.apiUrl,
      apiKey: props.provider.apiKey,
      model: props.provider.model,
      temperature: props.provider.temperature,
      proxyId: props.provider.proxyId || '',
    })

    watch(() => props.provider, (p) => {
      form.name = p.name
      form.apiUrl = p.apiUrl
      form.apiKey = p.apiKey
      form.model = p.model
      form.temperature = p.temperature
      form.proxyId = p.proxyId || ''
      formTouched.value = false
    }, { deep: true })

    function toggleExpanded() {
      expanded.value = !expanded.value
    }

    function handleSave() {
      formTouched.value = true
      if (!form.apiUrl.trim() || !form.model.trim() || !form.apiKey.trim()) {
        return
      }
      emit('update', props.provider.id, {
        name: form.name,
        apiUrl: form.apiUrl,
        apiKey: form.apiKey,
        model: form.model,
        temperature: form.temperature,
        proxyId: form.proxyId,
      })
      formTouched.value = false
    }

    return { showKey, expanded, form, formTouched, enabledProxies, toggleExpanded, handleSave }
  },
})
