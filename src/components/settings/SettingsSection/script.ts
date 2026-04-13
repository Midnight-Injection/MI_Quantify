import { defineComponent, ref } from 'vue'

export default defineComponent({
  name: 'SettingsSection',
  props: {
    title: { type: String, required: true },
    icon: { type: String, default: '📦' },
    defaultExpanded: { type: Boolean, default: true },
  },
  setup(props) {
    const expanded = ref(props.defaultExpanded)
    function toggle() { expanded.value = !expanded.value }
    return { expanded, toggle }
  },
})
