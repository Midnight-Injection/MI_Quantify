import { defineComponent, type PropType } from 'vue'
import type { DataSource } from '@/types'

export default defineComponent({
  name: 'DataSourceTable',
  props: {
    sources: { type: Array as PropType<DataSource[]>, required: true },
  },
  emits: ['toggle', 'config'],
})
