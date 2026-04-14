import { computed, defineComponent, onBeforeUnmount, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useMarketStore } from '@/stores/market'
import { useNotifications } from '@/composables/useNotifications'
import { useRealtimeTask } from '@/composables/useRealtimeTask'
import { formatAmount, formatPercent, formatPrice, formatVolume } from '@/utils/format'
import InfoTooltip from '@/components/common/InfoTooltip/index.vue'

export default defineComponent({
  name: 'MonitorView',
  components: { InfoTooltip },
  setup() {
    const router = useRouter()
    const marketStore = useMarketStore()
    const notifications = useNotifications()

    const watchedQuotes = computed(() =>
      marketStore.watchList.map((item) => ({
        ...item,
        quote: marketStore.quotes.get(item.code),
      })),
    )

    const enabledAlerts = computed(() => notifications.alerts.value.filter((item) => item.enabled))
    const recentNotifications = computed(() => notifications.notifications.value.slice(0, 16))

    const summaryCards = computed(() => [
      {
        label: '关注股',
        value: `${marketStore.watchList.length}`,
        hint: '集中查看你持续跟踪的股票',
      },
      {
        label: '运行中提醒',
        value: `${enabledAlerts.value.length}`,
        hint: '价格、涨停开板、跌停打开等监听规则',
      },
      {
        label: '最近通知',
        value: `${notifications.notifications.value.length}`,
        hint: '最近一次触发都会留痕，方便回看',
      },
    ])

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
      if (value === 'wechat') return '仅微信'
      return '桌面 + 微信'
    }

    const quoteTask = useRealtimeTask(refreshQuotes, {
      immediate: false,
      intervalMultiplier: 1,
      minimumMs: 5000,
      pauseWhenHidden: true,
    })

    onMounted(async () => {
      await loadAll()
      quoteTask.start(false)
    })

    onBeforeUnmount(() => {
      quoteTask.stop()
    })

    return {
      summaryCards,
      watchedQuotes,
      enabledAlerts,
      recentNotifications,
      formatPrice,
      formatPercent,
      formatVolume,
      formatAmount,
      removeWatch,
      toggleAlert,
      removeAlert,
      openStock,
      formatAlertDelivery,
    }
  },
})
