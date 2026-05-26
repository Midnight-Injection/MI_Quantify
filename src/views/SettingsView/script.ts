import { computed, defineComponent, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
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

    const toast = reactive({ visible: false, type: 'success' as 'success' | 'error', message: '' })
    let toastTimer: ReturnType<typeof setTimeout> | null = null

    function showToast(type: 'success' | 'error', message: string) {
      toast.visible = false
      if (toastTimer) clearTimeout(toastTimer)
      requestAnimationFrame(() => {
        toast.type = type
        toast.message = message
        toast.visible = true
        toastTimer = setTimeout(() => { toast.visible = false }, 2500)
      })
    }

    const tabs = [
      { key: 'ai', label: 'AI 模型', icon: 'BrainCircuit' },
      { key: 'search', label: '搜索', icon: 'Search' },
      { key: 'datasource', label: '数据源', icon: 'Database' },
      { key: 'proxy', label: '代理', icon: 'Shield' },
      { key: 'notify', label: '通知', icon: 'Bell' },
      { key: 'update', label: '版本更新', icon: 'Download' },
      { key: 'appearance', label: '外观', icon: 'Palette' },
    ]

    // ─── Form Local State ───
    const formAi = reactive({
      maxSteps: settingsStore.settings.ai.diagnosis.maxSteps,
      traceVerbose: settingsStore.settings.ai.diagnosis.traceVerbose,
    })

    const formDataSource = reactive({
      realTimeEnabled: settingsStore.settings.dataSource.realTimeEnabled,
      refreshInterval: settingsStore.settings.dataSource.refreshInterval,
    })

    const formNotify = reactive({
      desktopEnabled: settingsStore.settings.notifications.desktopEnabled,
    })

    const formAppearance = reactive({
      theme: settingsStore.settings.appearance.theme,
      fontSize: settingsStore.settings.appearance.fontSize,
    })

    const expandedSearchProviders = ref<string[]>([])

    watch(() => settingsStore.settings.ai.diagnosis.maxSteps, (v) => { formAi.maxSteps = v })
    watch(() => settingsStore.settings.ai.diagnosis.traceVerbose, (v) => { formAi.traceVerbose = v })
    watch(() => settingsStore.settings.dataSource.realTimeEnabled, (v) => { formDataSource.realTimeEnabled = v })
    watch(() => settingsStore.settings.dataSource.refreshInterval, (v) => { formDataSource.refreshInterval = v })
    watch(() => settingsStore.settings.notifications.desktopEnabled, (v) => { formNotify.desktopEnabled = v })
    watch(() => settingsStore.settings.appearance.theme, (v) => { formAppearance.theme = v })
    watch(() => settingsStore.settings.appearance.fontSize, (v) => { formAppearance.fontSize = v })

    // ─── Computed ───
    const channelStatuses = ref<Record<string, { loggedIn: boolean; listening: boolean; accountId?: string; userId?: string; status: string; error?: string }>>({})
    const qrSessions = ref<Record<string, { qrcode: string; qrcodeImg: string; status: string }>>({})
    const pollingTimers = new Map<string, ReturnType<typeof setInterval>>()
    const unlisteners: Array<() => void> = []
    const allChannels = computed(() => settingsStore.settings.integrations.openClaw.channels)
    const allProxies = computed(() => settingsStore.settings.proxy.proxies)

    const configurableDataSources = computed(() =>
      [...settingsStore.settings.dataSource.sources].sort((a, b) => {
        if (a.type !== b.type) return a.type === 'free' ? -1 : 1
        if (a.enabled !== b.enabled) return a.enabled ? -1 : 1
        return a.priority - b.priority
      }),
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
        idle: '待检查', unsupported: '仅桌面版可用', checking: '检查中',
        'up-to-date': '已是最新', available: '发现新版本', downloading: '下载中',
        installing: '安装中', completed: '安装完成', error: '检查失败',
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
      if (total && total > 0) return `${(downloaded / 1024 / 1024).toFixed(1)} / ${(total / 1024 / 1024).toFixed(1)} MB`
      return `${(downloaded / 1024 / 1024).toFixed(1)} MB`
    })

    // ─── Save Handlers ───
    function validateNotEmpty(value: string | undefined, fieldName: string): string | null {
      if (!value || !value.trim()) return `${fieldName}不能为空`
      return null
    }

    function saveAiAgent() {
      const steps = Math.min(20, Math.max(4, Number.isFinite(formAi.maxSteps) ? formAi.maxSteps : 20))
      settingsStore.settings.ai.diagnosis.maxSteps = steps
      settingsStore.settings.ai.diagnosis.traceVerbose = formAi.traceVerbose
      settingsStore.saveSettings()
      showToast('success', 'Agent 参数已保存')
    }

    function saveDataSourceOptions() {
      settingsStore.settings.dataSource.realTimeEnabled = formDataSource.realTimeEnabled
      settingsStore.settings.dataSource.refreshInterval = formDataSource.refreshInterval
      settingsStore.saveSettings()
      showToast('success', '推送设置已保存')
    }

    function saveNotification() {
      settingsStore.updateNotifications('desktopEnabled', formNotify.desktopEnabled)
      showToast('success', '通知设置已保存')
    }

    function saveAppearance() {
      settingsStore.updateAppearance('theme', formAppearance.theme as never)
      settingsStore.updateAppearance('fontSize', formAppearance.fontSize as never)
      showToast('success', '外观设置已保存')
    }

    function saveProxy(proxyId: string) {
      const proxy = allProxies.value.find((p) => p.id === proxyId)
      if (!proxy) return
      const nameErr = validateNotEmpty(proxy.name, '代理名称')
      const hostErr = validateNotEmpty(proxy.host, '代理地址')
      if (nameErr || hostErr) {
        showToast('error', [nameErr, hostErr].filter(Boolean).join('；'))
        return
      }
      settingsStore.updateProxy(proxyId, { ...proxy })
      showToast('success', '代理配置已保存')
    }

    function saveSearchProvider(providerId: string) {
      const provider = settingsStore.settings.ai.diagnosis.searchProviders.find((p) => p.id === providerId)
      if (!provider || !provider.enabled) return
      const urlErr = validateNotEmpty(provider.apiUrl, '搜索地址')
      const keyRequired = getSearchProviderRequiresKey(provider)
      const keyErr = keyRequired ? validateNotEmpty(provider.apiKey, '访问密钥') : null
      if (urlErr || keyErr) {
        showToast('error', [urlErr, keyErr].filter(Boolean).join('；'))
        return
      }
      settingsStore.saveSettings()
      showToast('success', '搜索配置已保存')
    }

    function saveChannel(channelId: string) {
      const channel = settingsStore.settings.integrations.openClaw.channels.find((c) => c.id === channelId)
      if (!channel) return
      const nameErr = validateNotEmpty(channel.name, '通道名称')
      if (channel.channelType === 'wechat') {
        const urlErr = validateNotEmpty(channel.baseUrl, '服务地址')
        if (nameErr || urlErr) {
          showToast('error', [nameErr, urlErr].filter(Boolean).join('；'))
          return
        }
      } else if (nameErr) {
        showToast('error', nameErr)
        return
      }
      settingsStore.saveSettings()
      showToast('success', '通知通道已保存')
    }

    // ─── Field Change Handlers (no auto-save) ───
    function handleProxyFieldChange(id: string, field: keyof ProxyConfig, value: string | number | boolean) {
      settingsStore.updateProxy(id, { [field]: value })
    }

    function handleSearchProviderFieldChange(id: string, field: string, value: string) {
      settingsStore.updateSearchProvider(id, { [field]: value } as Partial<SearchProvider>)
    }

    function handleChannelFieldChange(id: string, key: string, value: string) {
      const channel = settingsStore.settings.integrations.openClaw.channels.find((c) => c.id === id)
      if (!channel) return
      ;(channel as any)[key] = value
    }

    function handleToggleSearchProvider(id: string, e: Event) {
      settingsStore.updateSearchProvider(id, { enabled: (e.target as HTMLInputElement).checked })
    }

    function toggleSearchProvider(id: string) {
      const idx = expandedSearchProviders.value.indexOf(id)
      if (idx >= 0) expandedSearchProviders.value.splice(idx, 1)
      else expandedSearchProviders.value.push(id)
    }

    // ─── AI Provider Handlers (kept auto-save as they emit from card) ───
    function handleAddProvider() {
      const id = `ai_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
      const provider: AiProvider = {
        id,
        name: '',
        enabled: false,
        apiUrl: '',
        apiKey: '',
        model: '',
        maxTokens: 4096,
        temperature: 0.7,
      }
      settingsStore.addProvider(provider)
      showToast('success', '已添加新配置，请填写后保存')
    }

    function handleRemoveProvider(id: string) {
      settingsStore.removeProvider(id)
      showToast('success', '配置已删除')
    }

    function handleUpdateProvider(id: string, data: Record<string, unknown>) {
      settingsStore.updateProvider(id, data as Partial<AiProvider>)
      showToast('success', '模型配置已保存')
    }

    function handleToggleEnabled(id: string, enabled: boolean) {
      if (enabled) {
        for (const p of settingsStore.settings.ai.providers) {
          if (p.id !== id && p.enabled) settingsStore.updateProvider(p.id, { enabled: false })
        }
        settingsStore.updateProvider(id, { enabled })
        settingsStore.setActiveProvider(id)
      } else {
        settingsStore.updateProvider(id, { enabled })
        if (settingsStore.settings.ai.activeProviderId === id) settingsStore.setActiveProvider('')
      }
      showToast('success', '模型状态已更新')
    }

    function handleSetActive(id: string) {
      settingsStore.setActiveProvider(id)
      showToast('success', '已切换激活模型')
    }

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
          apiUrl: provider.apiUrl, apiKey: provider.apiKey, model: provider.model, proxy,
        })
        testingResult.value = result
        showToast('success', result)
      } catch (e) {
        testingResult.value = `失败: ${e}`
        showToast('error', `连接测试失败: ${e}`)
      } finally {
        setTimeout(() => { if (testingId.value === provider.id) testingId.value = '' }, 3000)
      }
    }

    function handleAddProxy() {
      const proxy: ProxyConfig = {
        id: `proxy_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        name: `代理 ${allProxies.value.length + 1}`,
        host: '', port: 7890, protocol: 'http', username: '', password: '', enabled: true,
      }
      settingsStore.addProxy(proxy)
      showToast('success', '已新增代理，请填写配置后保存')
    }

    function handleRemoveProxy(id: string) {
      settingsStore.removeProxy(id)
      showToast('success', '代理已删除')
    }

    function handleSetActiveSearchProvider(id: string) {
      settingsStore.setActiveSearchProvider(id)
      showToast('success', '已设为优先搜索源')
    }

    function handleToggleDataSource(id: string, enabled: boolean) {
      settingsStore.updateDataSource(id, { enabled })
      showToast('success', '数据源状态已更新')
    }

    function handleUpdateDataSource(id: string, data: Partial<DataSource>) {
      settingsStore.updateDataSource(id, data)
    }

    function handleAppUpdateAutoCheck(e: Event) {
      settingsStore.updateAppUpdate('autoCheck', (e.target as HTMLInputElement).checked)
      showToast('success', '更新检查设置已保存')
    }

    async function handleCheckAppUpdate() {
      await appUpdateStore.checkForUpdates()
    }

    async function handleInstallAppUpdate() {
      await appUpdateStore.installUpdate()
    }

    // ─── Search Helpers ───
    function getSearchProviderUrlPlaceholder(provider: SearchProvider) {
      const map: Record<string, string> = {
        zhipu: 'https://open.bigmodel.cn/api/paas/v4/tools',
        searxng: 'http://127.0.0.1:8080/search',
        yacy: 'http://127.0.0.1:8090/yacysearch.json',
        brave: 'https://api.search.brave.com/res/v1/web/search',
        tavily: 'https://api.tavily.com/search',
        serpapi: 'https://serpapi.com/search.json',
        serper: 'https://google.serper.dev/search',
        exa: 'https://api.exa.ai/search',
      }
      return map[provider.provider] || 'https://...'
    }

    function getSearchProviderKeyPlaceholder(provider: SearchProvider) {
      return ['searxng', 'yacy'].includes(provider.provider) ? '无则留空' : '请输入 API Key'
    }

    function getSearchProviderHint(provider: SearchProvider) {
      const map: Record<string, string> = {
        zhipu: '智谱内置 Web Search，适合中文财经与政策检索。',
        searxng: '开源自建聚合搜索，无需官方密钥。',
        yacy: '开源去中心化搜索，可本地部署。',
        brave: 'Brave Search 官方 API，国际新闻与网页覆盖较全。',
        tavily: '面向 AI Agent 的搜索 API，适合舆情研究与摘要。',
        serpapi: '聚合 Google / Bing 结果，适合跨地区检索。',
        serper: '轻量 Google Search API，延迟较低。',
        exa: '研究型搜索接口，适合深度网页发现。',
      }
      return map[provider.provider] || '支持自定义兼容搜索接口。'
    }

    function getSearchProviderRequiresKey(provider: SearchProvider) {
      return ['zhipu', 'brave', 'tavily', 'serpapi', 'serper', 'exa'].includes(provider.provider)
    }

    // ─── Channel Helpers ───
    function channelTypeLabel(type: OpenClawChannelType) {
      switch (type) {
        case 'wechat': return '微信'
        case 'qywx': return '企业微信'
        case 'webhook': return 'Webhook'
        default: return type
      }
    }

    function addChannel() {
      settingsStore.settings.integrations.openClaw.enabled = true
      settingsStore.settings.integrations.openClaw.channels.push({
        id: `ch_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        name: `通知通道 ${allChannels.value.length + 1}`,
        channelType: 'wechat',
        baseUrl: 'https://ilinkai.weixin.qq.com',
        pushUrl: '', secret: '', autoReplyEnabled: true,
      })
      settingsStore.saveSettings()
      showToast('success', '已新增通知通道，请填写配置后保存')
    }

    function removeChannel(id: string) {
      stopLoginPolling(id)
      delete qrSessions.value[id]
      delete channelStatuses.value[id]
      settingsStore.settings.integrations.openClaw.channels = settingsStore.settings.integrations.openClaw.channels.filter((c) => c.id !== id)
      settingsStore.saveSettings()
      showToast('success', '通知通道已删除')
    }

    function stopLoginPolling(id: string) {
      const timer = pollingTimers.get(id)
      if (!timer) return
      clearInterval(timer)
      pollingTimers.delete(id)
    }

    async function refreshChannelStatus(id: string) {
      const channel = settingsStore.settings.integrations.openClaw.channels.find((c) => c.id === id)
      if (!channel) return
      if (channel.channelType !== 'wechat') {
        channelStatuses.value[id] = { loggedIn: false, listening: false, status: '待配置' }
        return
      }
      try {
        const status = await invoke<{ channelId: string; loggedIn: boolean; listening: boolean; accountId?: string; userId?: string; baseUrl?: string }>('wechat_get_channel_status', { channelId: id })
        channelStatuses.value[id] = {
          loggedIn: status.loggedIn, listening: status.listening, accountId: status.accountId, userId: status.userId,
          status: status.listening ? '监听中' : status.loggedIn ? '已登录' : '未登录',
        }
      } catch (error) {
        channelStatuses.value[id] = {
          loggedIn: false, listening: false, status: '异常',
          error: error instanceof Error ? error.message : String(error),
        }
      }
    }

    async function startChannelLogin(channel: OpenClawChannelSettings) {
      if (channel.channelType !== 'wechat') return
      stopLoginPolling(channel.id)
      const qr = await invoke<{ qrcode: string; qrcodeImg: string }>('wechat_start_login', {
        channelId: channel.id, baseUrl: channel.baseUrl || undefined,
      })
      qrSessions.value[channel.id] = { qrcode: qr.qrcode, qrcodeImg: qr.qrcodeImg, status: 'waiting' }
      pollingTimers.set(channel.id, setInterval(async () => {
        try {
          const status = await invoke<{ status: string; botToken?: string; accountId?: string; userId?: string; baseUrl?: string }>('wechat_get_login_status', {
            channelId: channel.id, qrcode: qr.qrcode, baseUrl: channel.baseUrl || undefined,
          })
          qrSessions.value[channel.id] = { ...qrSessions.value[channel.id], status: status.status }
          if (status.status === 'confirmed') {
            stopLoginPolling(channel.id)
            await refreshChannelStatus(channel.id)
            try {
              await invoke('wechat_start_listener', { channelId: channel.id })
              await refreshChannelStatus(channel.id)
            } catch (error) {
              channelStatuses.value[channel.id] = {
                ...(channelStatuses.value[channel.id] || { loggedIn: true, listening: false, status: '异常' }),
                status: '异常', error: error instanceof Error ? error.message : String(error),
              }
            }
          }
          if (['cancelled', 'expired'].includes(status.status)) stopLoginPolling(channel.id)
        } catch (error) {
          stopLoginPolling(channel.id)
          channelStatuses.value[channel.id] = {
            ...(channelStatuses.value[channel.id] || { loggedIn: false, listening: false, status: '异常' }),
            status: '异常', error: error instanceof Error ? error.message : String(error),
          }
        }
      }, 3000))
    }

    async function logoutChannel(id: string) {
      const channel = settingsStore.settings.integrations.openClaw.channels.find((c) => c.id === id)
      if (!channel || channel.channelType !== 'wechat') return
      stopLoginPolling(id)
      delete qrSessions.value[id]
      await invoke('wechat_logout_channel', { channelId: id })
      await refreshChannelStatus(id)
    }

    function formatDateTime(value?: string) {
      if (!value) return '--'
      const date = new Date(value)
      if (Number.isNaN(date.getTime())) return '--'
      return date.toLocaleString('zh-CN', { hour12: false })
    }

    // ─── Lifecycle ───
    onMounted(async () => {
      await appUpdateStore.initialize()
      for (const channel of settingsStore.settings.integrations.openClaw.channels) {
        await refreshChannelStatus(channel.id)
      }
      unlisteners.push(
        await listen<{ channelId: string; status: string }>('wechat:status', async (event) => {
          if (event.payload?.channelId) await refreshChannelStatus(event.payload.channelId)
        }),
      )
      unlisteners.push(
        await listen<{ channelId: string; error: string }>('wechat:error', (event) => {
          if (!event.payload?.channelId) return
          channelStatuses.value[event.payload.channelId] = {
            ...(channelStatuses.value[event.payload.channelId] || { loggedIn: false, listening: false, status: '异常' }),
            status: '异常', error: event.payload.error,
          }
        }),
      )
    })

    onBeforeUnmount(() => {
      if (toastTimer) clearTimeout(toastTimer)
      pollingTimers.forEach((timer) => clearInterval(timer))
      pollingTimers.clear()
      for (const unlisten of unlisteners) unlisten()
    })

    return {
      settingsStore, toast, appUpdateStore,
      appUpdateProgressLabel, appUpdateStatusLabel, appUpdateStatusTone,
      testingId, testingResult, activeTab, tabs,
      formAi, formDataSource, formNotify, formAppearance,
      expandedSearchProviders,
      configurableDataSources,
      realtimeAiConfigStatus, aiConfigWarning,
      allChannels, allProxies, channelStatuses, qrSessions,
      channelTypeLabel, formatDateTime,
      getSearchProviderUrlPlaceholder, getSearchProviderKeyPlaceholder,
      getSearchProviderHint, getSearchProviderRequiresKey,
      saveAiAgent, saveDataSourceOptions, saveNotification,
      saveAppearance, saveProxy, saveSearchProvider, saveChannel,
      handleAddProvider, handleRemoveProvider,
      handleUpdateProvider, handleToggleEnabled, handleSetActive,
      handleTestConnection, handleToggleSearchProvider,
      handleSearchProviderFieldChange, toggleSearchProvider,
      handleSetActiveSearchProvider, handleToggleDataSource,
      handleUpdateDataSource, handleAppUpdateAutoCheck,
      handleCheckAppUpdate, handleInstallAppUpdate,
      handleAddProxy, handleRemoveProxy, handleProxyFieldChange,
      handleChannelFieldChange, addChannel, removeChannel,
      startChannelLogin, logoutChannel,
    }
  },
})
