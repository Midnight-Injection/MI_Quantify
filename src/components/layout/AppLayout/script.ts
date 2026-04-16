import { computed, defineComponent, onBeforeUnmount, onMounted } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { useSettingsStore } from '@/stores/settings'
import { useAppUpdateStore } from '@/stores/appUpdate'
import { useMarketStore } from '@/stores/market'
import { useNotifications } from '@/composables/useNotifications'
import { runDiagnosisAgent } from '@/agents/diagnosisAgent'
import { buildDiagnosisReply } from '@/utils/aiQuestion'
import { useSidecar } from '@/composables/useSidecar'
import { useRealtimeTask } from '@/composables/useRealtimeTask'
import { getStockProfile } from '@/utils/marketMetrics'
import AppSidebar from '@/components/layout/AppSidebar/index.vue'
import AppHeader from '@/components/layout/AppHeader/index.vue'

const cachedViewNames = ['HomeView', 'AskView', 'AnalysisView', 'StockDetailView', 'StrategyView']
const REALTIME_AI_CONFIG_NOTICE_KEY = 'miq:realtime-ai-config-notice:v1'

export default defineComponent({
  components: { AppSidebar, AppHeader },
  setup() {
    const settingsStore = useSettingsStore()
    const appUpdateStore = useAppUpdateStore()
    const marketStore = useMarketStore()
    const notifications = useNotifications()
    const { get } = useSidecar()
    const unlisteners: Array<() => void> = []
    const monitorMarkets = computed(() =>
      Array.from(
        new Set(
          [
            ...notifications.getTrackedCodes(),
            ...marketStore.watchList.map((item) => item.code),
          ].map((code) => {
            const market = getStockProfile(code).market
            return market === 'hk' ? 'hk' : market === 'us' ? 'us' : 'a'
          }),
        ),
      ),
    )
    const monitorTask = useRealtimeTask(async () => {
      const trackedCodes = Array.from(
        new Set([
          ...notifications.getTrackedCodes(),
          ...marketStore.watchList.map((item) => item.code),
        ]),
      )

      if (!trackedCodes.length) return
      try {
        const res = await get<{ data: Array<any> }>(`/api/market/quotes?codes=${trackedCodes.join(',')}`)
        await notifications.scanQuotes(res.data ?? [])
      } catch (error) {
        console.warn('[alert-monitor] failed:', error)
      }
    }, {
      intervalMultiplier: 1,
      immediate: false,
      minimumMs: 3000,
      market: () => monitorMarkets.value,
      pauseWhenHidden: false,
      skipWhenMarketClosed: true,
    })

    async function restoreWechatListeners() {
      const integration = settingsStore.settings.integrations.openClaw
      if (!integration.enabled) return

      const wechatChannels = integration.channels.filter(
        (item) => item.channelType === 'wechat',
      )

      for (const channel of wechatChannels) {
        try {
          const status = await invoke<{ loggedIn: boolean; listening: boolean }>('wechat_get_channel_status', {
            channelId: channel.id,
          })

          if (status.loggedIn && !status.listening) {
            await invoke('wechat_start_listener', { channelId: channel.id })
          }
        } catch (error) {
          console.warn(`[wechat-restore] failed for ${channel.id}:`, error)
        }
      }
    }

    async function maybeNotifyRealtimeAiConfig() {
      const status = settingsStore.realtimeAiConfigStatus
      if (status.ready) {
        window.localStorage.removeItem(REALTIME_AI_CONFIG_NOTICE_KEY)
        return
      }

      const missingParts = [
        status.activeAiReady ? '' : '大模型',
        status.activeSearchReady ? '' : '搜索引擎',
      ].filter(Boolean)
      const noticeToken = `${missingParts.join('+')}:${settingsStore.settings.ai.activeProviderId}:${settingsStore.settings.ai.diagnosis.activeSearchProviderId}`
      if (window.localStorage.getItem(REALTIME_AI_CONFIG_NOTICE_KEY) === noticeToken) return

      await notifications.pushNotification(
        'AI 评估配置未完成',
        `请先到设置页配置${missingParts.join('和')}，否则 AI 评估将无法接入实时外部数据、新闻与政策信息。`,
        { type: 'strategy' },
      )
      window.localStorage.setItem(REALTIME_AI_CONFIG_NOTICE_KEY, noticeToken)
    }

    async function handleWeChatInbound(event: {
      payload?: {
        channelId?: string
        message?: {
          fromUserId: string
          text?: string
          contextToken?: string
          isOutgoing?: boolean
        }
      }
    }) {
      const payload = event.payload
      const channelId = payload?.channelId
      const message = payload?.message
      if (!channelId || !message || message.isOutgoing) return

      const channel = settingsStore.settings.integrations.openClaw.channels.find(
        (item) => item.id === channelId,
      )
      if (!channel || !message.text?.trim()) return

      if (message.fromUserId && channel.defaultPeerId !== message.fromUserId) {
        channel.defaultPeerId = message.fromUserId
        settingsStore.saveSettings()
      }

      const text = message.text.trim()

      try {
        await invoke('wechat_send_message', {
          channelId,
          toUserId: message.fromUserId,
          text: '收到，正在分析，请稍候…',
          contextToken: message.contextToken || undefined,
        })

        const result = await runDiagnosisAgent({
          question: text,
          provider: settingsStore.activeProvider,
          searchProviders: settingsStore.enabledSearchProviders,
          activeSearchProvider: settingsStore.activeSearchProvider,
          maxSteps: settingsStore.settings.ai.diagnosis.maxSteps,
          period: 'daily',
          adjust: 'qfq',
        })
        await invoke('wechat_send_message', {
          channelId,
          toUserId: message.fromUserId,
          text: buildDiagnosisReply(result),
          contextToken: message.contextToken || undefined,
        })
      } catch (error) {
        console.warn('[wechat-auto-reply] failed:', error)
        try {
          await invoke('wechat_send_message', {
            channelId,
            toUserId: message.fromUserId,
            text: `分析过程出现异常：${error instanceof Error ? error.message : String(error)}`,
            contextToken: message.contextToken || undefined,
          })
        } catch {}
      }
    }

    onMounted(async () => {
      await settingsStore.loadSettings()
      await appUpdateStore.initialize()
      void appUpdateStore.runStartupCheck()
      unlisteners.push(
        await listen('wechat:message', async (event) => {
          await handleWeChatInbound(event as Parameters<typeof handleWeChatInbound>[0])
        }),
      )

      await restoreWechatListeners()
      await notifications.init()
      await maybeNotifyRealtimeAiConfig()
      await notifications.fetchAlerts()
      await notifications.fetchTasks()
      await marketStore.hydrateWatchList()
      monitorTask.start(false)
    })

    onBeforeUnmount(() => {
      monitorTask.stop()
      for (const unlisten of unlisteners) {
        unlisten()
      }
    })

    return {
      cachedViewNames,
    }
  },
})
