import { defineComponent, ref, type PropType } from 'vue'
import type { DataSource } from '@/types'

export default defineComponent({
  name: 'DataSourceTable',
  props: {
    sources: { type: Array as PropType<DataSource[]>, required: true },
  },
  emits: ['toggle', 'update'],
  setup() {
    const expandedSourceIds = ref<string[]>([])

    function isExpanded(id: string) {
      return expandedSourceIds.value.includes(id)
    }

    function toggleExpanded(id: string) {
      if (isExpanded(id)) {
        expandedSourceIds.value = expandedSourceIds.value.filter((item) => item !== id)
        return
      }
      expandedSourceIds.value = [...expandedSourceIds.value, id]
    }

    function getConfigHint(source: DataSource) {
      if (source.mode === 'sidecar') {
        return '免费内置源，地址由本地聚合统一托管，主要用于说明当前接入情况。'
      }
      if (source.type === 'free') {
        return '免费外部源，通常只需要填写访问地址或公开 Key。'
      }
      return '外部扩展源，按需填写访问地址、Key 和 Secret。'
    }

    return {
      expandedSourceIds,
      isExpanded,
      toggleExpanded,
      getConfigHint,
    }
  },
})
