import { defineComponent, ref, computed, onMounted, onBeforeUnmount, type Ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useNotifications } from '@/composables/useNotifications'
import { useAiTaskLogger } from '@/composables/useAiTaskLogger'
import { useMarketStore } from '@/stores/market'
import StockSearchInput from '@/components/common/StockSearchInput/index.vue'
import { resolveStockCodeFromInput } from '@/utils/aiQuestion'
import { Search, RefreshCw, Bell, Settings, X, Loader2, CheckCircle2, XCircle, AlertTriangle, Trash2 } from 'lucide-vue-next'

export default defineComponent({
  name: 'AppHeader',
  components: { Search, RefreshCw, Bell, Settings, X, Loader2, CheckCircle2, XCircle, AlertTriangle, Trash2, StockSearchInput },
  setup() {
    const route = useRoute()
    const router = useRouter()
    const marketStore = useMarketStore()
    const searchQuery = ref('')
    const showNotifPanel = ref(false)
    const notifPanelRef = ref<HTMLElement | null>(null)
    const notifTab = ref<'notifications' | 'aiLogs'>('notifications')
    const { notifications, markAllRead, clearNotifications } = useNotifications()
    const aiTaskLogger = useAiTaskLogger()

    const unreadCount = computed(() => {
      const notifCount = notifications.value.filter((n) => !n.read).length
      const activeAiCount = aiTaskLogger.activeTasks.value.length
      return notifCount + activeAiCount
    })

    const sourceLabel: Record<string, string> = {
      home: '首页',
      analysis: '个股分析',
      stockDetail: '个股详情',
      ask: 'AI问股',
    }

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
      if (showNotifPanel.value) {
        markAllRead()
      }
    }

    function cancelAiTask(taskId: string) {
      aiTaskLogger.cancelTask(taskId)
    }

    function clearFinishedAiTasks() {
      aiTaskLogger.clearFinishedTasks()
    }

    function formatLogTime(ts: number) {
      return new Date(ts).toLocaleTimeString('zh-CN', { hour12: false })
    }

    function formatDuration(ms: number) {
      const sec = Math.round(ms / 1000)
      if (sec < 60) return `${sec}s`
      return `${Math.floor(sec / 60)}m${sec % 60}s`
    }

    let unlisten: (() => void) | null = null

    function handleClickOutside(e: MouseEvent) {
      if (!showNotifPanel.value) return
      const panel = notifPanelRef.value
      if (panel && !panel.contains(e.target as Node)) {
        const bellTrigger = (e.target as HTMLElement).closest('.has-badge')
        if (!bellTrigger) {
          showNotifPanel.value = false
        }
      }
    }

    onMounted(async () => {
      document.addEventListener('mousedown', handleClickOutside)
      try {
        const { listen } = await import('@tauri-apps/api/event')
        unlisten = await listen<{ title: string; body: string }>('notification', (event) => {
          notifications.value.unshift({
            title: event.payload.title,
            body: event.payload.body,
            time: Date.now(),
            read: false,
          })
        })
      } catch {}
    })

    onBeforeUnmount(() => {
      document.removeEventListener('mousedown', handleClickOutside)
      unlisten?.()
    })

    return {
      pageTitle,
      searchQuery,
      showNotifPanel,
      notifPanelRef,
      notifTab,
      notifications,
      unreadCount,
      aiTaskLogger,
      sourceLabel,
      handleSearch,
      handleSelectStock,
      handleRefresh,
      toggleNotifPanel,
      cancelAiTask,
      clearFinishedAiTasks,
      clearNotifications,
      formatLogTime,
      formatDuration,
    }
  },
})
