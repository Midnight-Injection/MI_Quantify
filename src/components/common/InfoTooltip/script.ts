import { computed, defineComponent, nextTick, onBeforeUnmount, ref } from 'vue'

export default defineComponent({
  name: 'InfoTooltip',
  props: {
    title: {
      type: String,
      required: true,
    },
    description: {
      type: String,
      required: true,
    },
    range: {
      type: String,
      default: '',
    },
    placement: {
      type: String,
      default: 'top',
    },
  },
  setup(props) {
    const rootRef = ref<HTMLElement | null>(null)
    const bubbleRef = ref<HTMLElement | null>(null)
    const open = ref(false)
    const resolvedPlacement = ref<'top' | 'bottom' | 'right'>(
      props.placement === 'bottom' ? 'bottom' : props.placement === 'right' ? 'right' : 'top',
    )
    const alignClass = ref<'center' | 'start' | 'end'>('center')

    function syncPlacement() {
      if (!rootRef.value || !bubbleRef.value || typeof window === 'undefined') return
      const rootRect = rootRef.value.getBoundingClientRect()
      const bubbleRect = bubbleRef.value.getBoundingClientRect()
      const viewportWidth = window.innerWidth
      const viewportHeight = window.innerHeight

      let placement: 'top' | 'bottom' | 'right' =
        props.placement === 'bottom' ? 'bottom' : props.placement === 'right' ? 'right' : 'top'

      if (placement === 'top' && rootRect.top < bubbleRect.height + 18) {
        placement = 'bottom'
      } else if (placement === 'bottom' && viewportHeight - rootRect.bottom < bubbleRect.height + 18) {
        placement = 'top'
      } else if (placement === 'right' && viewportWidth - rootRect.right < bubbleRect.width + 18) {
        placement = rootRect.top > bubbleRect.height + 18 ? 'top' : 'bottom'
      }

      resolvedPlacement.value = placement

      if (placement === 'right') {
        alignClass.value = 'start'
        return
      }

      const centerLeft = rootRect.left + rootRect.width / 2 - bubbleRect.width / 2
      const centerRight = centerLeft + bubbleRect.width
      if (centerLeft < 12) {
        alignClass.value = 'start'
      } else if (centerRight > viewportWidth - 12) {
        alignClass.value = 'end'
      } else {
        alignClass.value = 'center'
      }
    }

    async function openTooltip() {
      open.value = true
      await nextTick()
      syncPlacement()
      window.addEventListener('resize', syncPlacement)
      window.addEventListener('scroll', syncPlacement, true)
    }

    function closeTooltip() {
      open.value = false
      window.removeEventListener('resize', syncPlacement)
      window.removeEventListener('scroll', syncPlacement, true)
    }

    onBeforeUnmount(() => {
      closeTooltip()
    })

    const tooltipClasses = computed(() => [
      `is-${resolvedPlacement.value}`,
      `align-${alignClass.value}`,
      { 'is-open': open.value },
    ])

    return {
      rootRef,
      bubbleRef,
      open,
      tooltipClasses,
      openTooltip,
      closeTooltip,
    }
  },
})
