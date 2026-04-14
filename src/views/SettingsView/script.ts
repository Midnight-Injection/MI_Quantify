import { computed, defineComponent, onBeforeUnmount, onMounted, ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { useSettingsStore } from '@/stores/settings'
import { useStrategyStore } from '@/stores/strategy'
import type { AiProvider, DataSource, OpenClawChannelSettings, SearchProvider } from '@/types'
import AiProviderCard from '@/components/settings/AiProviderCard/index.vue'
import DataSourceTable from '@/components/settings/DataSourceTable/index.vue'
import PromptEditor from '@/components/settings/PromptEditor/index.vue'
import { BrainCircuit, Database, FileText, Bell, Palette } from 'lucide-vue-next'

export default defineComponent({
  name: 'SettingsView',
  components: { AiProviderCard, DataSourceTable, PromptEditor, BrainCircuit, Database, FileText, Bell, Palette },
  setup() {
    const settingsStore = useSettingsStore()
    const strategyStore = useStrategyStore()
    const testingId = ref('')
    const testingResult = ref('')
    const activeTab = ref('ai')
    const importingLocal = ref(false)
    const localImportResult = ref('')
    const channelStatuses = ref<Record<string, { loggedIn: boolean; listening: boolean; accountId?: string; userId?: string; status: string; error?: string }>>({})
    const qrSessions = ref<Record<string, { qrcode: string; qrcodeImg: string; status: string }>>({})
    const pollingTimers = new Map<string, ReturnType<typeof setInterval>>()
    const unlisteners: Array<() => void> = []
    const wechatChannels = computed(() =>
      settingsStore.settings.integrations.openClaw.channels.filter((item) => item.channelType === 'wechat'),
    )
    const configurableDataSources = computed(() =>
      [...settingsStore.settings.dataSource.sources].sort((a, b) => {
        if (a.type !== b.type) {
          return a.type === 'free' ? -1 : 1
        }
        if (a.enabled !== b.enabled) {
          return a.enabled ? -1 : 1
        }
        return a.priority - b.priority
      }),
    )

    async function handleTestConnection(provider: AiProvider) {
      testingId.value = provider.id
      testingResult.value = ''
      try {
        const result = await invoke<string>('test_ai_connection', {
          apiUrl: provider.apiUrl,
          apiKey: provider.apiKey,
          model: provider.model,
        })
        testingResult.value = result
      } catch (e) {
        testingResult.value = `失败: ${e}`
      } finally {
        setTimeout(() => {
          if (testingId.value === provider.id) {
            testingId.value = ''
          }
        }, 3000)
      }
    }

    function handleUpdateProvider(id: string, data: Record<string, unknown>) {
      settingsStore.updateProvider(id, data as Partial<AiProvider>)
    }

    function handleToggleEnabled(id: string, enabled: boolean) {
      settingsStore.updateProvider(id, { enabled })
    }

    function handleSetActive(id: string) {
      settingsStore.setActiveProvider(id)
    }

    function handleUpdateSearchProvider(id: string, data: Partial<SearchProvider>) {
      settingsStore.updateSearchProvider(id, data)
    }

    function handleSetActiveSearchProvider(id: string) {
      settingsStore.setActiveSearchProvider(id)
    }

    function handleToggleDataSource(id: string, enabled: boolean) {
      settingsStore.updateDataSource(id, { enabled })
    }

    function handleUpdateDataSource(id: string, data: Partial<DataSource>) {
      settingsStore.updateDataSource(id, data)
    }

    function handleRefreshInterval(e: Event) {
      const val = parseInt((e.target as HTMLSelectElement).value)
      settingsStore.settings.dataSource.refreshInterval = val
      settingsStore.saveSettings()
    }

    function handleRealTimeToggle(e: Event) {
      settingsStore.settings.dataSource.realTimeEnabled = (e.target as HTMLInputElement).checked
      settingsStore.saveSettings()
    }

    async function handleImportLocalProvider() {
      importingLocal.value = true
      localImportResult.value = ''
      try {
        await settingsStore.maybeImportLocalProvider(true)
        localImportResult.value = settingsStore.activeProvider ? '已导入本机 OpenCode / 智谱配置' : '未发现可用的本机模型配置'
      } catch (error) {
        localImportResult.value = `导入失败: ${error instanceof Error ? error.message : String(error)}`
      } finally {
        importingLocal.value = false
      }
    }

    function handleDiagnosisMaxSteps(e: Event) {
      settingsStore.settings.ai.diagnosis.maxSteps = parseInt((e.target as HTMLSelectElement).value)
      settingsStore.saveSettings()
    }

    function handleDiagnosisToggle(key: 'traceVerbose' | 'autoImportLocalProvider', e: Event) {
      settingsStore.settings.ai.diagnosis[key] = (e.target as HTMLInputElement).checked
      settingsStore.saveSettings()
    }

    function handleAiAutoRunToggle(
      key: 'homeDigest' | 'marketDigest' | 'analysisDigest' | 'stockDetailDiagnosis',
      e: Event,
    ) {
      settingsStore.updateAiAutoRun(key, (e.target as HTMLInputElement).checked)
    }

    function handleUpdatePrompt(id: string, content: string) {
      strategyStore.updatePromptTemplate(id, content)
    }

    function handleResetPrompt(id: string) {
      strategyStore.resetPromptTemplate(id)
    }

    function handleUpdateOpenClaw<
      K extends keyof typeof settingsStore.settings.integrations.openClaw,
    >(key: K, value: (typeof settingsStore.settings.integrations.openClaw)[K]) {
      settingsStore.updateOpenClaw(key, value)
    }

    function createChannelId() {
      return `wechat_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    }

    function createChannel(): OpenClawChannelSettings {
      const index = wechatChannels.value.length + 1
      return {
        id: createChannelId(),
        name: `微信通道 ${index}`,
        channelType: 'wechat',
        enabled: true,
        autoStart: true,
        baseUrl: 'https://ilinkai.weixin.qq.com',
        pushUrl: '',
        secret: '',
        autoReplyEnabled: true,
        pushEnabled: true,
      }
    }

    function addChannel() {
      settingsStore.settings.integrations.openClaw.enabled = true
      settingsStore.settings.integrations.openClaw.channels.push(createChannel())
      settingsStore.saveSettings()
    }

    function updateChannel<K extends keyof OpenClawChannelSettings>(
      id: string,
      key: K,
      value: OpenClawChannelSettings[K],
    ) {
      const channel = settingsStore.settings.integrations.openClaw.channels.find((item) => item.id === id)
      if (!channel) return
      channel[key] = value
      settingsStore.saveSettings()
    }

    function removeChannel(id: string) {
      stopLoginPolling(id)
      delete qrSessions.value[id]
      delete channelStatuses.value[id]
      settingsStore.settings.integrations.openClaw.channels = settingsStore.settings.integrations.openClaw.channels.filter((item) => item.id !== id)
      settingsStore.saveSettings()
    }

    function stopLoginPolling(id: string) {
      const timer = pollingTimers.get(id)
      if (!timer) return
      clearInterval(timer)
      pollingTimers.delete(id)
    }

    async function refreshChannelStatus(id: string) {
      const channel = settingsStore.settings.integrations.openClaw.channels.find((item) => item.id === id)
      if (!channel) return
      if (channel.channelType !== 'wechat') {
        channelStatuses.value[id] = {
          loggedIn: false,
          listening: false,
          status: '待配置',
        }
        return
      }
      try {
        const status = await invoke<{
          channelId: string
          loggedIn: boolean
          listening: boolean
          accountId?: string
          userId?: string
          baseUrl?: string
        }>('wechat_get_channel_status', { channelId: id })
        channelStatuses.value[id] = {
          loggedIn: status.loggedIn,
          listening: status.listening,
          accountId: status.accountId,
          userId: status.userId,
          status: status.listening ? '监听中' : status.loggedIn ? '已登录' : '未登录',
        }
      } catch (error) {
        channelStatuses.value[id] = {
          loggedIn: false,
          listening: false,
          status: '异常',
          error: error instanceof Error ? error.message : String(error),
        }
      }
    }

    async function startChannelLogin(channel: OpenClawChannelSettings) {
      if (channel.channelType !== 'wechat') return
      stopLoginPolling(channel.id)
      const qr = await invoke<{ qrcode: string; qrcodeImg: string }>('wechat_start_login', {
        channelId: channel.id,
        baseUrl: channel.baseUrl || undefined,
      })
      qrSessions.value[channel.id] = {
        qrcode: qr.qrcode,
        qrcodeImg: qr.qrcodeImg,
        status: 'waiting',
      }
      pollingTimers.set(channel.id, setInterval(async () => {
        try {
          const status = await invoke<{
            status: string
            botToken?: string
            accountId?: string
            userId?: string
            baseUrl?: string
          }>('wechat_get_login_status', {
            channelId: channel.id,
            qrcode: qr.qrcode,
            baseUrl: channel.baseUrl || undefined,
          })
          qrSessions.value[channel.id] = {
            ...qrSessions.value[channel.id],
            status: status.status,
          }
          if (status.status === 'confirmed') {
            stopLoginPolling(channel.id)
            await refreshChannelStatus(channel.id)
          }
          if (['cancelled', 'expired'].includes(status.status)) {
            stopLoginPolling(channel.id)
          }
        } catch (error) {
          stopLoginPolling(channel.id)
          channelStatuses.value[channel.id] = {
            ...(channelStatuses.value[channel.id] || { loggedIn: false, listening: false, status: '异常' }),
            status: '异常',
            error: error instanceof Error ? error.message : String(error),
          }
        }
      }, 3000))
    }

    async function startChannelListener(id: string) {
      const channel = settingsStore.settings.integrations.openClaw.channels.find((item) => item.id === id)
      if (!channel || channel.channelType !== 'wechat') return
      await invoke('wechat_start_listener', { channelId: id })
      await refreshChannelStatus(id)
    }

    async function stopChannelListener(id: string) {
      const channel = settingsStore.settings.integrations.openClaw.channels.find((item) => item.id === id)
      if (!channel || channel.channelType !== 'wechat') return
      await invoke('wechat_stop_listener', { channelId: id })
      await refreshChannelStatus(id)
    }

    async function logoutChannel(id: string) {
      const channel = settingsStore.settings.integrations.openClaw.channels.find((item) => item.id === id)
      if (!channel || channel.channelType !== 'wechat') return
      stopLoginPolling(id)
      delete qrSessions.value[id]
      await invoke('wechat_logout_channel', { channelId: id })
      await refreshChannelStatus(id)
    }

    onMounted(async () => {
      for (const channel of settingsStore.settings.integrations.openClaw.channels) {
        await refreshChannelStatus(channel.id)
      }

      unlisteners.push(
        await listen<{ channelId: string; status: string }>('wechat:status', async (event) => {
          const payload = event.payload
          if (!payload?.channelId) return
          await refreshChannelStatus(payload.channelId)
        }),
      )
      unlisteners.push(
        await listen<{ channelId: string; error: string }>('wechat:error', (event) => {
          const payload = event.payload
          if (!payload?.channelId) return
          channelStatuses.value[payload.channelId] = {
            ...(channelStatuses.value[payload.channelId] || { loggedIn: false, listening: false, status: '异常' }),
            status: '异常',
            error: payload.error,
          }
        }),
      )
    })

    onBeforeUnmount(() => {
      pollingTimers.forEach((timer) => clearInterval(timer))
      pollingTimers.clear()
      for (const unlisten of unlisteners) {
        unlisten()
      }
    })

    return {
      settingsStore,
      strategyStore,
      testingId,
      testingResult,
      activeTab,
      importingLocal,
      localImportResult,
      handleTestConnection,
      handleUpdateProvider,
      handleToggleEnabled,
      handleSetActive,
      handleUpdateSearchProvider,
      handleSetActiveSearchProvider,
      handleToggleDataSource,
      handleUpdateDataSource,
      handleRefreshInterval,
      handleRealTimeToggle,
      handleImportLocalProvider,
      handleDiagnosisMaxSteps,
      handleDiagnosisToggle,
      handleAiAutoRunToggle,
      handleUpdatePrompt,
      handleResetPrompt,
      handleUpdateOpenClaw,
      configurableDataSources,
      wechatChannels,
      channelStatuses,
      qrSessions,
      addChannel,
      updateChannel,
      removeChannel,
      startChannelLogin,
      startChannelListener,
      stopChannelListener,
      logoutChannel,
    }
  },
})
