import { computed, defineComponent, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useMarketStore } from '@/stores/market'
import { useNotifications } from '@/composables/useNotifications'
import { useRealtimeTask } from '@/composables/useRealtimeTask'
import { useSettingsStore } from '@/stores/settings'
import { formatAmount, formatPercent, formatPrice } from '@/utils/format'
import { getStockProfile } from '@/utils/marketMetrics'

export default defineComponent({
  name: 'MonitorView',
  setup() {
    const router = useRouter()
    const marketStore = useMarketStore()
    const notifications = useNotifications()
    const activeTab = ref<'watch' | 'alert'>('watch')

    const watchedQuotes = computed(() =>
      marketStore.watchList.map((item) => ({
        ...item,
        quote: marketStore.quotes.get(item.code),
      })),
    )
    const trackedMarkets = computed(() =>
      Array.from(
        new Set(
          marketStore.watchList.map((item) => {
            const market = getStockProfile(item.code).market
            return market === 'hk' ? 'hk' : market === 'us' ? 'us' : 'a'
          }),
        ),
      ),
    )

    const enabledAlerts = computed(() => notifications.alerts.value.filter((item) => item.enabled))
    const recentNotifications = computed(() => notifications.notifications.value.slice(0, 16))

    function barWidth(quote: any) {
      if (!quote) return '0%'
      const ref_ = quote.preClose || quote.open || quote.price
      if (!ref_) return '0%'
      const range = Math.max(Math.abs(quote.high - quote.low), ref_ * 0.01)
      const pos = (quote.price - quote.low) / range
      return `${Math.max(8, Math.min(100, pos * 100))}%`
    }

    async function refreshQuotes() {
      const codes = marketStore.watchList.map((item) => item.code)
      if (!codes.length) return
      await marketStore.fetchQuotes(codes)
    }

    async function loadAll() {
      await Promise.all([
        marketStore.hydrateWatchList(),
        notifications.init(),
        notifications.fetchAlerts(),
      ])
      await refreshQuotes()
    }

    async function removeWatch(code: string) {
      await marketStore.removeFromWatchList(code)
      await refreshQuotes()
    }

    async function toggleAlert(id: string, enabled: boolean) {
      await notifications.toggleAlert(id, enabled)
    }

    async function removeAlert(id: string) {
      await notifications.removeAlert(id)
    }

    function openStock(code: string) {
      router.push({ name: 'stockDetail', params: { code } })
    }

    function formatAlertDelivery(value?: string | number | boolean) {
      if (value === 'desktop') return '仅桌面'
      if (typeof value === 'string' && value !== 'all' && value !== 'wechat') {
        const settingsStore = useSettingsStore()
        const ch = settingsStore.settings.integrations.openClaw.channels.find((c) => c.id === value)
        if (ch) return ch.name
      }
      if (value === 'wechat') return '仅微信'
      return '桌面 + 微信'
    }

    const quoteTask = useRealtimeTask(refreshQuotes, {
      immediate: false,
      intervalMultiplier: 1,
      minimumMs: 3000,
      market: () => trackedMarkets.value,
      pauseWhenHidden: true,
      skipWhenMarketClosed: true,
    })

    onMounted(async () => {
      await loadAll()
      quoteTask.start(false)
    })

    onBeforeUnmount(() => {
      quoteTask.stop()
    })

    return {
      activeTab,
      watchedQuotes,
      enabledAlerts,
      recentNotifications,
      barWidth,
      formatPrice,
      formatPercent,
      formatAmount,
      removeWatch,
      toggleAlert,
      removeAlert,
      openStock,
      formatAlertDelivery,
    }
  },
})
