import { computed, defineComponent, onBeforeUnmount, onMounted, ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { useSettingsStore } from '@/stores/settings'
import { useAppUpdateStore } from '@/stores/appUpdate'
import type { AiProvider, DataSource, OpenClawChannelSettings, OpenClawChannelType, ProxyConfig, SearchProvider } from '@/types'
import AiProviderCard from '@/components/settings/AiProviderCard/index.vue'
import DataSourceTable from '@/components/settings/DataSourceTable/index.vue'
import { BrainCircuit, Database, Bell, Palette, Search, Download, Shield } from 'lucide-vue-next'

export default defineComponent({
  name: 'SettingsView',
  components: { AiProviderCard, DataSourceTable, BrainCircuit, Database, Bell, Palette, Search, Download, Shield },
  setup() {
    const settingsStore = useSettingsStore()
    const appUpdateStore = useAppUpdateStore()
    const testingId = ref('')
    const testingResult = ref('')
    const activeTab = ref('ai')
    const channelStatuses = ref<Record<string, { loggedIn: boolean; listening: boolean; accountId?: string; userId?: string; status: string; error?: string }>>({})
    const qrSessions = ref<Record<string, { qrcode: string; qrcodeImg: string; status: string }>>({})
    const pollingTimers = new Map<string, ReturnType<typeof setInterval>>()
    const unlisteners: Array<() => void> = []
    const allChannels = computed(() =>
      settingsStore.settings.integrations.openClaw.channels,
    )

    const allProxies = computed(() => settingsStore.settings.proxy.proxies)

    function createProxyId() {
      return `proxy_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    }

    function handleAddProxy() {
      const proxy: ProxyConfig = {
        id: createProxyId(),
        name: `代理 ${allProxies.value.length + 1}`,
        host: '',
        port: 7890,
        protocol: 'http',
        username: '',
        password: '',
        enabled: true,
      }
      settingsStore.addProxy(proxy)
    }

    function handleRemoveProxy(id: string) {
      settingsStore.removeProxy(id)
    }

    function handleUpdateProxy(id: string, data: Partial<ProxyConfig>) {
      settingsStore.updateProxy(id, data)
    }

    function handleProxyChange(id: string, field: keyof ProxyConfig, value: string | number | boolean) {
      settingsStore.updateProxy(id, { [field]: value })
    }

    function proxyOptions() {
      return [
        { id: '', name: '不使用代理' },
        ...allProxies.value.filter((p) => p.enabled).map((p) => ({ id: p.id, name: p.name })),
      ]
    }
    function channelTypeLabel(type: OpenClawChannelType) {
      switch (type) {
        case 'wechat': return '微信'
        case 'qywx': return '企业微信'
        case 'webhook': return 'Webhook'
        default: return type
      }
    }
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
    const dataRealtimeEnabled = computed(() => settingsStore.settings.dataSource.realTimeEnabled)
    const anyAiAutoRunEnabled = computed(() =>
      Object.values(settingsStore.settings.ai.autoRun).some(Boolean),
    )
    const realtimeAiConfigStatus = computed(() => settingsStore.realtimeAiConfigStatus)
    const aiConfigWarning = computed(() => {
      const missingParts = [
        realtimeAiConfigStatus.value.activeAiReady ? '' : '大模型',
        realtimeAiConfigStatus.value.activeSearchReady ? '' : '搜索引擎',
      ].filter(Boolean)
      if (!missingParts.length) return ''
      return `当前未完成${missingParts.join('和')}配置，AI 评估将缺少实时外部数据、政策和新闻支撑。`
    })
    const appUpdateStatusLabel = computed(() => {
      const map: Record<string, string> = {
        idle: '待检查',
        unsupported: '仅桌面版可用',
        checking: '检查中',
        'up-to-date': '已是最新',
        available: '发现新版本',
        downloading: '下载中',
        installing: '安装中',
        completed: '安装完成',
        error: '检查失败',
      }
      return map[appUpdateStore.status] || '待检查'
    })
    const appUpdateStatusTone = computed(() => {
      if (appUpdateStore.status === 'available' || appUpdateStore.status === 'completed') return 'positive'
      if (appUpdateStore.status === 'error') return 'danger'
      if (appUpdateStore.status === 'downloading' || appUpdateStore.status === 'installing' || appUpdateStore.status === 'checking') return 'accent'
      return 'neutral'
    })
    const appUpdateProgressLabel = computed(() => {
      if (!appUpdateStore.progress) return ''
      const downloaded = appUpdateStore.progress.downloadedBytes
      const total = appUpdateStore.progress.contentLength
      if (total && total > 0) {
        return `${(downloaded / 1024 / 1024).toFixed(1)} / ${(total / 1024 / 1024).toFixed(1)} MB`
      }
      return `${(downloaded / 1024 / 1024).toFixed(1)} MB`
    })

    async function handleTestConnection(provider: AiProvider) {
      testingId.value = provider.id
      testingResult.value = ''
      try {
        let proxy = null
        if (provider.proxyId) {
          proxy = settingsStore.getProxyById(provider.proxyId) || null
          if (proxy && (!proxy.enabled || !proxy.host.trim())) proxy = null
        }
        const result = await invoke<string>('test_ai_connection', {
          apiUrl: provider.apiUrl,
          apiKey: provider.apiKey,
          model: provider.model,
          proxy,
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
      if (enabled) {
        for (const p of settingsStore.settings.ai.providers) {
          if (p.id !== id && p.enabled) {
            settingsStore.updateProvider(p.id, { enabled: false })
          }
        }
        settingsStore.updateProvider(id, { enabled })
        settingsStore.setActiveProvider(id)
      } else {
        settingsStore.updateProvider(id, { enabled })
        if (settingsStore.settings.ai.activeProviderId === id) {
          settingsStore.setActiveProvider('')
        }
      }
    }

    function handleSetActive(id: string) {
      settingsStore.setActiveProvider(id)
    }

    function handleUpdateSearchProvider(id: string, data: Partial<SearchProvider>) {
      settingsStore.updateSearchProvider(id, data)
    }

    function getSearchProviderUrlPlaceholder(provider: SearchProvider) {
      switch (provider.provider) {
        case 'zhipu':
          return 'https://open.bigmodel.cn/api/paas/v4/tools'
        case 'searxng':
          return 'http://127.0.0.1:8080/search'
        case 'yacy':
          return 'http://127.0.0.1:8090/yacysearch.json'
        case 'brave':
          return 'https://api.search.brave.com/res/v1/web/search'
        case 'tavily':
          return 'https://api.tavily.com/search'
        case 'serpapi':
          return 'https://serpapi.com/search.json'
        case 'serper':
          return 'https://google.serper.dev/search'
        case 'exa':
          return 'https://api.exa.ai/search'
        default:
          return 'https://...'
      }
    }

    function getSearchProviderKeyPlaceholder(provider: SearchProvider) {
      return ['searxng', 'yacy'].includes(provider.provider) ? '无则留空' : '请输入 API Key'
    }

    function getSearchProviderHint(provider: SearchProvider) {
      switch (provider.provider) {
        case 'zhipu':
          return '智谱内置 Web Search，适合中文财经与政策检索。'
        case 'searxng':
          return '开源自建聚合搜索，无需官方密钥。'
        case 'yacy':
          return '开源去中心化搜索，可本地部署。'
        case 'brave':
          return 'Brave Search 官方 API，国际新闻与网页覆盖较全。'
        case 'tavily':
          return '面向 AI Agent 的搜索 API，适合舆情研究与摘要。'
        case 'serpapi':
          return '聚合 Google / Bing 结果，适合跨地区检索。'
        case 'serper':
          return '轻量 Google Search API，延迟较低。'
        case 'exa':
          return '研究型搜索接口，适合深度网页发现。'
        default:
          return '支持自定义兼容搜索接口。'
      }
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

    function handleDiagnosisMaxSteps(e: Event) {
      const raw = parseInt((e.target as HTMLInputElement).value, 10)
      settingsStore.settings.ai.diagnosis.maxSteps = Math.min(100, Math.max(4, Number.isFinite(raw) ? raw : 20))
      settingsStore.saveSettings()
    }

    function handleAiAutoRunInterval(e: Event) {
      const raw = parseInt((e.target as HTMLInputElement).value, 10)
      settingsStore.updateAiAutoRunInterval(Number.isFinite(raw) ? raw : settingsStore.settings.ai.autoRunInterval)
    }

    function handleDiagnosisToggle(key: 'traceVerbose', e: Event) {
      settingsStore.settings.ai.diagnosis[key] = (e.target as HTMLInputElement).checked
      settingsStore.saveSettings()
    }

    function handleAiAutoRunToggle(
      key: 'homeDigest' | 'marketDigest' | 'analysisDigest' | 'stockDetailDiagnosis',
      e: Event,
    ) {
      settingsStore.updateAiAutoRun(key, (e.target as HTMLInputElement).checked)
    }

    function handleAppUpdateAutoCheck(e: Event) {
      settingsStore.updateAppUpdate('autoCheck', (e.target as HTMLInputElement).checked)
    }

    async function handleCheckAppUpdate() {
      await appUpdateStore.checkForUpdates()
    }

    async function handleInstallAppUpdate() {
      await appUpdateStore.installUpdate()
    }

    function formatDateTime(value?: string) {
      if (!value) return '--'
      const date = new Date(value)
      if (Number.isNaN(date.getTime())) return '--'
      return date.toLocaleString('zh-CN', { hour12: false })
    }

    function createChannelId() {
      return `ch_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    }

    function createChannel(): OpenClawChannelSettings {
      const index = allChannels.value.length + 1
      return {
        id: createChannelId(),
        name: `通知通道 ${index}`,
        channelType: 'wechat',
        baseUrl: 'https://ilinkai.weixin.qq.com',
        pushUrl: '',
        secret: '',
        autoReplyEnabled: true,
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
            try {
              await invoke('wechat_start_listener', { channelId: channel.id })
              await refreshChannelStatus(channel.id)
            } catch (error) {
              channelStatuses.value[channel.id] = {
                ...(channelStatuses.value[channel.id] || { loggedIn: true, listening: false, status: '异常' }),
                status: '异常',
                error: error instanceof Error ? error.message : String(error),
              }
            }
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

    async function logoutChannel(id: string) {
      const channel = settingsStore.settings.integrations.openClaw.channels.find((item) => item.id === id)
      if (!channel || channel.channelType !== 'wechat') return
      stopLoginPolling(id)
      delete qrSessions.value[id]
      await invoke('wechat_logout_channel', { channelId: id })
      await refreshChannelStatus(id)
    }

    onMounted(async () => {
      await appUpdateStore.initialize()
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
      appUpdateStore,
      appUpdateProgressLabel,
      appUpdateStatusLabel,
      appUpdateStatusTone,
      testingId,
      testingResult,
      activeTab,
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
      handleDiagnosisMaxSteps,
      handleAiAutoRunInterval,
      handleDiagnosisToggle,
      handleAppUpdateAutoCheck,
      handleCheckAppUpdate,
      handleAiAutoRunToggle,
      handleInstallAppUpdate,
      configurableDataSources,
      dataRealtimeEnabled,
      formatDateTime,
      anyAiAutoRunEnabled,
      realtimeAiConfigStatus,
      aiConfigWarning,
      allChannels,
      channelTypeLabel,
      channelStatuses,
      qrSessions,
      getSearchProviderUrlPlaceholder,
      getSearchProviderKeyPlaceholder,
      getSearchProviderHint,
      addChannel,
      updateChannel,
      removeChannel,
      startChannelLogin,
      logoutChannel,
      allProxies,
      handleAddProxy,
      handleRemoveProxy,
      handleUpdateProxy,
      handleProxyChange,
      proxyOptions,
    }
  },
})
