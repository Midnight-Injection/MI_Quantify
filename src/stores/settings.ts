import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import type { AppSettings, AiAutoRunSettings, AiProvider, DataSource, ProxyConfig, SearchProvider } from '@/types'
import { DEFAULT_SETTINGS } from '@/types/settings'
import { AI_PROVIDER_PRESETS, DATA_SOURCE_PRESETS, SEARCH_PROVIDER_PRESETS } from '@/utils/constants'
import { useSidecar } from '@/composables/useSidecar'

const STORE_KEY = 'app_settings'
const LOCAL_PROXY_PRESET_ID = 'local_proxy_127001_7890'
const LOCAL_PROXY_PRESET: ProxyConfig = {
  id: LOCAL_PROXY_PRESET_ID,
  name: '本地代理 127.0.0.1:7890',
  host: '127.0.0.1',
  port: 7890,
  protocol: 'http',
  username: '',
  password: '',
  enabled: true,
}

const ZHIPU_CODING_BASE_URL = 'https://open.bigmodel.cn/api/coding/paas/v4'
const ZHIPU_CODING_MODEL = 'zhipuai-coding-plan/glm-5.1'
const LEGACY_ZHIPU_URLS = new Set([
  'https://open.bigmodel.cn/api/paas/v4/chat/completions',
  'https://open.bigmodel.cn/api/paas/v4',
])

export const useSettingsStore = defineStore('settings', () => {
  const settings = ref<AppSettings>(JSON.parse(JSON.stringify(DEFAULT_SETTINGS)))
  const initialized = ref(false)

  function providerRequiresApiKey(provider: AiProvider | null | undefined) {
    return !!provider
  }

  function searchProviderRequiresApiKey(provider: SearchProvider | null | undefined) {
    if (!provider) return false
    return ['zhipu', 'brave', 'tavily', 'serpapi', 'serper', 'exa'].includes(provider.provider)
  }

  function isAiProviderConfigured(provider: AiProvider | null | undefined) {
    if (!provider?.enabled) return false
    if (!provider.apiUrl.trim() || !provider.model.trim()) return false
    if (providerRequiresApiKey(provider) && !provider.apiKey.trim()) return false
    return true
  }

  function isSearchProviderConfigured(provider: SearchProvider | null | undefined) {
    if (!provider?.enabled) return false
    if (!provider.apiUrl.trim()) return false
    if (searchProviderRequiresApiKey(provider) && !provider.apiKey.trim()) return false
    return true
  }

  function buildDefaultSettings(): AppSettings {
    return {
      ...DEFAULT_SETTINGS,
      ai: {
        ...DEFAULT_SETTINGS.ai,
        providers: AI_PROVIDER_PRESETS.map((p) => ({ ...p, apiKey: '' })),
        activeProviderId: '',
        diagnosis: {
          ...DEFAULT_SETTINGS.ai.diagnosis,
          searchProviders: SEARCH_PROVIDER_PRESETS.map((p) => ({ ...p, apiKey: '' })),
          activeSearchProviderId: '',
        },
        autoRun: {
          ...DEFAULT_SETTINGS.ai.autoRun,
        },
      },
      dataSource: {
        ...DEFAULT_SETTINGS.dataSource,
        sources: DATA_SOURCE_PRESETS.map((s) => ({ ...s, apiKey: '', apiSecret: '' })),
      },
      proxy: {
        ...DEFAULT_SETTINGS.proxy,
        proxies: [{ ...LOCAL_PROXY_PRESET }],
      },
    }
  }

  function mergePresetItems<T extends { id: string }>(defaults: T[], saved: T[] | undefined): T[] {
    if (!saved?.length) return defaults
    const savedMap = new Map(saved.map((item) => [item.id, item]))
    const merged = defaults.map((item) => ({ ...item, ...(savedMap.get(item.id) || {}) }))
    const extra = saved.filter((item) => !defaults.some((preset) => preset.id === item.id))
    return [...merged, ...extra]
  }

  function mergeSettings(saved: Partial<AppSettings>): AppSettings {
    const defaults = buildDefaultSettings()
    const savedProxies = saved.proxy?.proxies || []
    const hasLocalProxy = savedProxies.some((proxy) => {
      const host = String(proxy.host || '').trim()
      return (host === '127.0.0.1' || host === 'localhost') && Number(proxy.port || 0) === 7890
    })
    const mergedProxies = hasLocalProxy
      ? savedProxies
      : [{ ...LOCAL_PROXY_PRESET }, ...savedProxies]
    const merged = {
      ...defaults,
      ...saved,
      ai: {
        ...defaults.ai,
        ...saved.ai,
        autoRunInterval: normalizeAutoRunInterval(saved.ai?.autoRunInterval ?? defaults.ai.autoRunInterval),
        providers: mergePresetItems(defaults.ai.providers, saved.ai?.providers),
        diagnosis: {
          ...defaults.ai.diagnosis,
          ...saved.ai?.diagnosis,
          maxSteps: normalizeMaxSteps(saved.ai?.diagnosis?.maxSteps ?? defaults.ai.diagnosis.maxSteps),
          searchProviders: mergePresetItems(defaults.ai.diagnosis.searchProviders, saved.ai?.diagnosis?.searchProviders),
        },
        autoRun: {
          ...defaults.ai.autoRun,
          ...saved.ai?.autoRun,
        },
      },
      dataSource: {
        ...defaults.dataSource,
        ...saved.dataSource,
        sources: mergePresetItems(defaults.dataSource.sources, saved.dataSource?.sources),
      },
      appUpdate: {
        ...defaults.appUpdate,
        ...saved.appUpdate,
      },
      watchList: {
        ...defaults.watchList,
        ...saved.watchList,
      },
      notifications: {
        ...defaults.notifications,
        ...saved.notifications,
      },
      integrations: {
        ...defaults.integrations,
        ...saved.integrations,
        openClaw: {
          ...defaults.integrations.openClaw,
          ...saved.integrations?.openClaw,
          channels: saved.integrations?.openClaw?.channels?.length
            ? saved.integrations.openClaw.channels.map((channel) => ({
              ...channel,
              autoReplyEnabled: true,
            }))
            : defaults.integrations.openClaw.channels,
        },
      },
      appearance: {
        ...defaults.appearance,
        ...saved.appearance,
      },
      proxy: {
        ...defaults.proxy,
        ...saved.proxy,
        proxies: mergedProxies,
      },
    }

    const zhipuProvider = merged.ai.providers.find((provider) => provider.id === 'zhipu')
    if (zhipuProvider && (!zhipuProvider.apiUrl.trim() || LEGACY_ZHIPU_URLS.has(zhipuProvider.apiUrl.trim()))) {
      zhipuProvider.apiUrl = ZHIPU_CODING_BASE_URL
      if (!zhipuProvider.model.trim() || zhipuProvider.model.trim() === 'glm-5.1') {
        zhipuProvider.model = ZHIPU_CODING_MODEL
      }
    }

    return merged
  }

  async function loadSettings() {
    try {
      const saved = await invoke<AppSettings | null>('app_store_get', { key: STORE_KEY })
      if (saved) {
        settings.value = mergeSettings(saved)
      } else {
        await initDefaults()
      }
      initialized.value = true
      syncProxies()
    } catch {
      await initDefaults()
      initialized.value = true
      syncProxies()
    }
  }

  async function initDefaults() {
    settings.value = buildDefaultSettings()
    await saveSettings()
  }

  async function saveSettings() {
    try {
      await invoke('app_store_set', { key: STORE_KEY, value: settings.value })
    } catch (e) {
      console.error('Failed to save settings:', e)
    }
  }

  function syncProxies() {
    const { syncProxiesToSidecar } = useSidecar()
    syncProxiesToSidecar(settings.value.proxy.proxies)
  }

  watch(() => settings.value.proxy.proxies, syncProxies, { deep: true })

  const activeProvider = computed<AiProvider | null>(() => {
    return settings.value.ai.providers.find((p) => p.id === settings.value.ai.activeProviderId && p.enabled) ?? null
  })

  const activeSearchProvider = computed(() => {
    return settings.value.ai.diagnosis.searchProviders.find((p) => p.id === settings.value.ai.diagnosis.activeSearchProviderId && p.enabled) ?? null
  })

  const hasConfiguredAiProvider = computed(() => {
    return settings.value.ai.providers.some((provider) => isAiProviderConfigured(provider))
  })

  const hasConfiguredSearchProvider = computed(() => {
    return settings.value.ai.diagnosis.searchProviders.some((provider) => isSearchProviderConfigured(provider))
  })

  const realtimeAiConfigStatus = computed(() => {
    const activeAiReady = isAiProviderConfigured(activeProvider.value)
    const activeSearchReady = isSearchProviderConfigured(activeSearchProvider.value)
    return {
      activeAiReady,
      activeSearchReady,
      hasConfiguredAiProvider: hasConfiguredAiProvider.value,
      hasConfiguredSearchProvider: hasConfiguredSearchProvider.value,
      ready: activeAiReady && activeSearchReady,
    }
  })

  const enabledSearchProviders = computed(() => {
    const activeId = settings.value.ai.diagnosis.activeSearchProviderId
    return settings.value.ai.diagnosis.searchProviders
      .filter((provider) => isSearchProviderConfigured(provider))
      .sort((a, b) => {
        if (a.id === activeId) return -1
        if (b.id === activeId) return 1
        return 0
      })
  })

  function updateProvider(id: string, data: Partial<AiProvider>) {
    const idx = settings.value.ai.providers.findIndex((p) => p.id === id)
    if (idx !== -1) {
      settings.value.ai.providers[idx] = { ...settings.value.ai.providers[idx], ...data }
    }
    saveSettings()
  }

  function setActiveProvider(id: string) {
    settings.value.ai.activeProviderId = id
    saveSettings()
  }

  function updateSearchProvider(id: string, data: Partial<SearchProvider>) {
    const idx = settings.value.ai.diagnosis.searchProviders.findIndex((p) => p.id === id)
    if (idx !== -1) {
      settings.value.ai.diagnosis.searchProviders[idx] = { ...settings.value.ai.diagnosis.searchProviders[idx], ...data }
    }
    saveSettings()
  }

  function setActiveSearchProvider(id: string) {
    settings.value.ai.diagnosis.activeSearchProviderId = id
    saveSettings()
  }

  function updateAiAutoRun<K extends keyof AiAutoRunSettings>(key: K, value: AiAutoRunSettings[K]) {
    settings.value.ai.autoRun[key] = value
    saveSettings()
  }

  function updateAiAutoRunInterval(value: number) {
    settings.value.ai.autoRunInterval = normalizeAutoRunInterval(value)
    saveSettings()
  }

  function updateDataSource(id: string, data: Partial<DataSource>) {
    const idx = settings.value.dataSource.sources.findIndex((s) => s.id === id)
    if (idx !== -1) {
      settings.value.dataSource.sources[idx] = { ...settings.value.dataSource.sources[idx], ...data }
    }
    saveSettings()
  }

  function updateAppUpdate<K extends keyof AppSettings['appUpdate']>(key: K, value: AppSettings['appUpdate'][K]) {
    settings.value.appUpdate[key] = value
    saveSettings()
  }

  function updateAppearance<K extends keyof AppSettings['appearance']>(key: K, value: AppSettings['appearance'][K]) {
    settings.value.appearance[key] = value
    saveSettings()
  }

  function updateNotifications<K extends keyof AppSettings['notifications']>(key: K, value: AppSettings['notifications'][K]) {
    settings.value.notifications[key] = value
    saveSettings()
  }

  function updateOpenClaw<K extends keyof AppSettings['integrations']['openClaw']>(
    key: K,
    value: AppSettings['integrations']['openClaw'][K],
  ) {
    settings.value.integrations.openClaw[key] = value
    saveSettings()
  }

  function addProxy(proxy: ProxyConfig) {
    settings.value.proxy.proxies.push(proxy)
    saveSettings()
  }

  function updateProxy(id: string, data: Partial<ProxyConfig>) {
    const idx = settings.value.proxy.proxies.findIndex((p) => p.id === id)
    if (idx !== -1) {
      settings.value.proxy.proxies[idx] = { ...settings.value.proxy.proxies[idx], ...data }
    }
    saveSettings()
  }

  function removeProxy(id: string) {
    settings.value.proxy.proxies = settings.value.proxy.proxies.filter((p) => p.id !== id)
    for (const ds of settings.value.dataSource.sources) {
      if (ds.proxyId === id) ds.proxyId = ''
    }
    for (const p of settings.value.ai.providers) {
      if (p.proxyId === id) p.proxyId = ''
    }
    for (const sp of settings.value.ai.diagnosis.searchProviders) {
      if (sp.proxyId === id) sp.proxyId = ''
    }
    saveSettings()
  }

  function getProxyById(id: string): ProxyConfig | undefined {
    return settings.value.proxy.proxies.find((p) => p.id === id)
  }

  return {
    settings,
    initialized,
    activeProvider,
    activeSearchProvider,
    hasConfiguredAiProvider,
    hasConfiguredSearchProvider,
    realtimeAiConfigStatus,
    enabledSearchProviders,
    loadSettings,
    saveSettings,
    updateProvider,
    setActiveProvider,
    updateSearchProvider,
    setActiveSearchProvider,
    updateAiAutoRun,
    updateAiAutoRunInterval,
    updateAppUpdate,
    updateDataSource,
    updateAppearance,
    updateNotifications,
    updateOpenClaw,
    addProxy,
    updateProxy,
    removeProxy,
    getProxyById,
    isAiProviderConfigured,
  }
})
  function normalizeMaxSteps(value: number) {
    if (!Number.isFinite(value)) return 20
    return Math.min(100, Math.max(4, Math.round(value)))
  }

  function normalizeAutoRunInterval(value: number) {
    if (!Number.isFinite(value)) return 45
    return Math.min(600, Math.max(10, Math.round(value)))
  }
