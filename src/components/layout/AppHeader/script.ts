import { defineComponent, ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useNotifications } from '@/composables/useNotifications'
import { useMarketStore } from '@/stores/market'
import StockSearchInput from '@/components/common/StockSearchInput/index.vue'
import { resolveStockCodeFromInput } from '@/utils/aiQuestion'
import { Search, RefreshCw, Bell, Settings, X } from 'lucide-vue-next'

export default defineComponent({
  name: 'AppHeader',
  components: { Search, RefreshCw, Bell, Settings, X, StockSearchInput },
  setup() {
    const route = useRoute()
    const router = useRouter()
    const marketStore = useMarketStore()
    const searchQuery = ref('')
    const showNotifPanel = ref(false)
    const { notifications, alerts } = useNotifications()

    const unreadCount = computed(() => notifications.value.length)

    const pageTitle = computed(() => {
      const titles: Record<string, string> = {
        home: '首页',
        market: '行情中心',
        analysis: '技术分析',
        ask: 'AI问股',
        strategy: '策略中心',
        settings: '设置',
        stockDetail: '股票详情',
      }
      return titles[route.name as string] ?? 'MI Quantify'
    })

    async function openStock(code: string) {
      await router.push({ name: 'stockDetail', params: { code } })
      searchQuery.value = ''
    }

    async function handleSelectStock(item: { code: string }) {
      await openStock(item.code)
    }

    async function handleSearch(keywordFromInput?: string) {
      const keyword = (keywordFromInput || searchQuery.value).trim()
      if (!keyword) return

      const code = await resolveStockCodeFromInput(keyword, marketStore.searchStock, marketStore.stockList)
      if (code) await openStock(code)
    }

    function handleRefresh() {
      window.location.reload()
    }

    function toggleNotifPanel() {
      showNotifPanel.value = !showNotifPanel.value
    }

    let unlisten: (() => void) | null = null

    onMounted(async () => {
      try {
        const { listen } = await import('@tauri-apps/api/event')
        unlisten = await listen<{ title: string; body: string }>('notification', (event) => {
          notifications.value.unshift({
            title: event.payload.title,
            body: event.payload.body,
            time: Date.now(),
          })
        })
      } catch {}
    })

    onBeforeUnmount(() => {
      unlisten?.()
    })

    return {
      pageTitle,
      searchQuery,
      showNotifPanel,
      notifications,
      unreadCount,
      handleSearch,
      handleSelectStock,
      handleRefresh,
      toggleNotifPanel,
    }
  },
})
