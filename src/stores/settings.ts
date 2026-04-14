import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { AppSettings, AiAutoRunSettings, AiProvider, DataSource, SearchProvider } from '@/types'
import { DEFAULT_SETTINGS } from '@/types/settings'
import { AI_PROVIDER_PRESETS, DATA_SOURCE_PRESETS, SEARCH_PROVIDER_PRESETS } from '@/utils/constants'
import { load } from '@tauri-apps/plugin-store'
import { invoke } from '@tauri-apps/api/core'

const STORE_KEY = 'app_settings'
const STORE_FILE = 'settings.json'

export const useSettingsStore = defineStore('settings', () => {
  const settings = ref<AppSettings>(JSON.parse(JSON.stringify(DEFAULT_SETTINGS)))
  const initialized = ref(false)
  let storeInstance: Awaited<ReturnType<typeof load>> | null = null

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
    return {
      ...defaults,
      ...saved,
      ai: {
        ...defaults.ai,
        ...saved.ai,
        providers: mergePresetItems(defaults.ai.providers, saved.ai?.providers),
        diagnosis: {
          ...defaults.ai.diagnosis,
          ...saved.ai?.diagnosis,
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
              autoStart: channel.autoStart ?? channel.channelType === 'wechat',
              autoReplyEnabled: true,
              pushEnabled: true,
            }))
            : defaults.integrations.openClaw.channels,
        },
      },
      appearance: {
        ...defaults.appearance,
        ...saved.appearance,
      },
    }
  }

  async function getStore() {
    if (!storeInstance) {
      storeInstance = await load(STORE_FILE)
    }
    return storeInstance
  }

  async function loadSettings() {
    try {
      const store = await getStore()
      const saved = await store.get<AppSettings>(STORE_KEY)
      if (saved) {
        settings.value = mergeSettings(saved)
      } else {
        await initDefaults()
      }
      await maybeImportLocalProvider()
      initialized.value = true
    } catch {
      await initDefaults()
      await maybeImportLocalProvider()
      initialized.value = true
    }
  }

  async function initDefaults() {
    settings.value = buildDefaultSettings()
    await saveSettings()
  }

  async function maybeImportLocalProvider(force = false) {
    if (!settings.value.ai.diagnosis.autoImportLocalProvider && !force) return

    const zhipuProvider = settings.value.ai.providers.find((item) => item.id === 'zhipu')
    const zhipuSearch = settings.value.ai.diagnosis.searchProviders.find((item) => item.id === 'zhipu-web-search')
    const providerReady = !!zhipuProvider?.apiKey
    const searchReady = !!zhipuSearch?.apiKey

    if (!force && providerReady && searchReady) return

    try {
      const local = await invoke<{
        providerId: string
        apiKey: string
        apiUrl: string
        model: string
        searchApiUrl?: string
        searchApiKey?: string
      } | null>('load_local_ai_config')

      if (!local?.apiKey) return

      const provider = settings.value.ai.providers.find((item) => item.id === 'zhipu')
      if (provider) {
        provider.apiKey = local.apiKey
        provider.apiUrl = local.apiUrl || provider.apiUrl
        provider.model = local.model || provider.model
        provider.enabled = true
        if (!settings.value.ai.activeProviderId) {
          settings.value.ai.activeProviderId = provider.id
        }
      }

      const searchProvider = settings.value.ai.diagnosis.searchProviders.find((item) => item.id === 'zhipu-web-search')
      if (searchProvider) {
        searchProvider.apiKey = local.searchApiKey || local.apiKey
        searchProvider.apiUrl = local.searchApiUrl || searchProvider.apiUrl
        searchProvider.enabled = true
        if (!settings.value.ai.diagnosis.activeSearchProviderId) {
          settings.value.ai.diagnosis.activeSearchProviderId = searchProvider.id
        }
      }

      await saveSettings()
    } catch (error) {
      console.warn('[settings] local AI config import skipped:', error)
    }
  }

  async function saveSettings() {
    try {
      const store = await getStore()
      await store.set(STORE_KEY, settings.value)
    } catch (e) {
      console.error('Failed to save settings:', e)
    }
  }

  const activeProvider = computed<AiProvider | null>(() => {
    return settings.value.ai.providers.find((p) => p.id === settings.value.ai.activeProviderId && p.enabled) ?? null
  })

  const activeSearchProvider = computed(() => {
    return settings.value.ai.diagnosis.searchProviders.find((p) => p.id === settings.value.ai.diagnosis.activeSearchProviderId && p.enabled) ?? null
  })

  const enabledSearchProviders = computed(() => {
    const activeId = settings.value.ai.diagnosis.activeSearchProviderId
    return settings.value.ai.diagnosis.searchProviders
      .filter((provider) => provider.enabled && provider.apiUrl.trim())
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

  function updateDataSource(id: string, data: Partial<DataSource>) {
    const idx = settings.value.dataSource.sources.findIndex((s) => s.id === id)
    if (idx !== -1) {
      settings.value.dataSource.sources[idx] = { ...settings.value.dataSource.sources[idx], ...data }
    }
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

  return {
    settings,
    initialized,
    activeProvider,
    activeSearchProvider,
    enabledSearchProviders,
    loadSettings,
    saveSettings,
    maybeImportLocalProvider,
    updateProvider,
    setActiveProvider,
    updateSearchProvider,
    setActiveSearchProvider,
    updateAiAutoRun,
    updateDataSource,
    updateAppearance,
    updateNotifications,
    updateOpenClaw,
  }
})
