import { defineComponent, ref, type PropType } from 'vue'
import type { SectorData } from '@/types'
import { formatPercent, formatVolume } from '@/utils/format'

export default defineComponent({
  name: 'SectorRank',
  props: {
    sectors: { type: Array as PropType<SectorData[]>, default: () => [] },
  },
  emits: ['switch'],
  setup() {
    const activeTab = ref<'industry' | 'concept'>('industry')
    return { activeTab, formatPercent, formatVolume }
  },
})
