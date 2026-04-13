import { defineComponent, computed, ref } from 'vue'
import { useRoute } from 'vue-router'
import { useAppStore } from '@/stores/app'
import { NAV_ITEMS } from '@/utils/constants'
import {
  Home,
  BarChart3,
  CandlestickChart,
  BrainCircuit,
  MessageSquareText,
  Settings,
  TrendingUp,
  BellRing,
  ChevronLeft,
  ChevronRight,
} from 'lucide-vue-next'

const ICON_MAP: Record<string, any> = {
  Home,
  BarChart3,
  CandlestickChart,
  BrainCircuit,
  MessageSquareText,
  Settings,
  BellRing,
}

export default defineComponent({
  name: 'AppSidebar',
  components: { TrendingUp, ChevronLeft, ChevronRight },
  setup() {
    const route = useRoute()
    const appStore = useAppStore()
    const currentPath = computed(() => route.path)
    const hoveredItem = ref<string | null>(null)

    function getIcon(iconName: string) {
      return ICON_MAP[iconName]
    }

    return {
      appStore,
      currentPath,
      NAV_ITEMS,
      getIcon,
      hoveredItem,
      ChevronLeft,
      ChevronRight,
    }
  },
})
