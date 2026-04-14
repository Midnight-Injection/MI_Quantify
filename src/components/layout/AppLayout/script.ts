import { defineComponent, onBeforeUnmount, onMounted } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { useSettingsStore } from '@/stores/settings'
import { useMarketStore } from '@/stores/market'
import { useNotifications } from '@/composables/useNotifications'
import { runDiagnosisAgent } from '@/agents/diagnosisAgent'
import { buildDiagnosisReply, resolveStockFromQuestion } from '@/utils/aiQuestion'
import { useSidecar } from '@/composables/useSidecar'
import { useRealtimeTask } from '@/composables/useRealtimeTask'
import AppSidebar from '@/components/layout/AppSidebar/index.vue'
import AppHeader from '@/components/layout/AppHeader/index.vue'

export default defineComponent({
  components: { AppSidebar, AppHeader },
  setup() {
    const settingsStore = useSettingsStore()
    const marketStore = useMarketStore()
    const notifications = useNotifications()
    const { get } = useSidecar()
    const unlisteners: Array<() => void> = []
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
    }, { intervalMultiplier: 2, immediate: false, minimumMs: 10000, pauseWhenHidden: true })

    async function restoreWechatListeners() {
      const integration = settingsStore.settings.integrations.openClaw
      if (!integration.enabled) return

      const wechatChannels = integration.channels.filter(
        (item) => item.channelType === 'wechat' && item.enabled && item.autoStart,
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
        (item) => item.id === channelId && item.enabled,
      )
      if (!channel || !message.text?.trim()) return

      const text = message.text.trim()

      try {
        const resolved = await resolveStockFromQuestion(text, marketStore.searchStock, marketStore.stockList)
        if (!resolved) return

        const result = await runDiagnosisAgent({
          code: resolved.code,
          provider: settingsStore.activeProvider,
          searchProviders: settingsStore.enabledSearchProviders,
          activeSearchProvider: settingsStore.activeSearchProvider,
          maxSteps: settingsStore.settings.ai.diagnosis.maxSteps,
          period: 'daily',
          adjust: 'qfq',
          question: text,
          resolvedName: resolved.name,
          matchedKeyword: resolved.keyword,
          matchCandidates: resolved.candidates,
        })
        await invoke('wechat_send_message', {
          channelId,
          toUserId: message.fromUserId,
          text: buildDiagnosisReply(result, resolved),
          contextToken: message.contextToken || undefined,
        })
      } catch (error) {
        console.warn('[wechat-auto-reply] failed:', error)
      }
    }

    onMounted(async () => {
      await settingsStore.loadSettings()
      unlisteners.push(
        await listen('wechat:message', async (event) => {
          await handleWeChatInbound(event as Parameters<typeof handleWeChatInbound>[0])
        }),
      )

      await restoreWechatListeners()
      await notifications.init()
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
    const cachedViewNames = ['HomeView', 'AskView', 'AnalysisView', 'StockDetailView', 'StrategyView']
