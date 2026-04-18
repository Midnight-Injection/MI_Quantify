import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { getVersion } from '@tauri-apps/api/app'
import { invoke } from '@tauri-apps/api/core'
import { isTauri } from '@tauri-apps/api/core'
import { relaunch } from '@tauri-apps/plugin-process'
import { check, type Update } from '@tauri-apps/plugin-updater'
import { useSettingsStore } from '@/stores/settings'

type AppUpdateStatus =
  | 'idle'
  | 'unsupported'
  | 'checking'
  | 'up-to-date'
  | 'available'
  | 'downloading'
  | 'installing'
  | 'completed'
  | 'error'

interface AppUpdateInfo {
  version: string
  currentVersion: string
  publishedAt: string | null
  notes: string | null
}

interface AppUpdateProgress {
  contentLength: number | null
  downloadedBytes: number
  percent: number | null
}

function detectWindows() {
  if (typeof navigator === 'undefined') return false
  const browserNavigator = navigator as Navigator & {
    userAgentData?: {
      platform?: string
    }
  }
  const platform = browserNavigator.userAgentData?.platform || browserNavigator.platform || browserNavigator.userAgent
  return /win/i.test(platform)
}

function normalizeUpdate(update: Update): AppUpdateInfo {
  return {
    version: update.version,
    currentVersion: update.currentVersion,
    publishedAt: update.date ?? null,
    notes: update.body ?? null,
  }
}

export const useAppUpdateStore = defineStore('appUpdate', () => {
  const settingsStore = useSettingsStore()
  const currentVersion = ref('...')
  const status = ref<AppUpdateStatus>('idle')
  const availableUpdate = ref<AppUpdateInfo | null>(null)
  const progress = ref<AppUpdateProgress | null>(null)
  const errorMessage = ref('')
  const initialized = ref(false)
  let currentUpdate: Update | null = null

  const supported = computed(() => isTauri())
  const isBusy = computed(() => ['checking', 'downloading', 'installing'].includes(status.value))
  const lastCheckedAt = computed(() => settingsStore.settings.appUpdate.lastCheckedAt)

  async function syncProxyEnv() {
    if (!supported.value) return
    try {
      await invoke('set_proxy_env', { proxies: settingsStore.settings.proxy.proxies })
    } catch (e) {
      console.warn('[app-update] failed to sync proxy env:', e)
    }
  }

  async function initialize() {
    if (initialized.value) return

    if (!supported.value) {
      status.value = 'unsupported'
      initialized.value = true
      return
    }

    try {
      currentVersion.value = await getVersion()
      status.value = 'idle'
    } catch (error) {
      status.value = 'error'
      errorMessage.value = error instanceof Error ? error.message : String(error)
    } finally {
      initialized.value = true
    }
  }

  async function checkForUpdates(options: { silent?: boolean } = {}) {
    const silent = options.silent ?? false
    await initialize()

    if (!supported.value) {
      status.value = 'unsupported'
      return null
    }

    if (isBusy.value) {
      return availableUpdate.value
    }

    status.value = 'checking'
    errorMessage.value = ''
    progress.value = null

    try {
      await syncProxyEnv()
      const update = await check()
      settingsStore.updateAppUpdate('lastCheckedAt', new Date().toISOString())

      if (!update) {
        currentUpdate = null
        availableUpdate.value = null
        status.value = 'up-to-date'
        return null
      }

      currentUpdate = update
      currentVersion.value = update.currentVersion
      availableUpdate.value = normalizeUpdate(update)
      status.value = 'available'
      return availableUpdate.value
    } catch (error) {
      status.value = 'error'
      errorMessage.value = error instanceof Error ? error.message : String(error)
      if (silent) {
        console.warn('[app-update] silent check failed:', errorMessage.value)
      }
      return null
    }
  }

  async function installUpdate() {
    if (!currentUpdate || !availableUpdate.value || isBusy.value) {
      return false
    }

    errorMessage.value = ''
    progress.value = {
      contentLength: null,
      downloadedBytes: 0,
      percent: null,
    }
    status.value = 'downloading'

    try {
      await syncProxyEnv()
      await currentUpdate.downloadAndInstall((event) => {
        if (event.event === 'Started') {
          progress.value = {
            contentLength: event.data.contentLength ?? null,
            downloadedBytes: 0,
            percent: event.data.contentLength ? 0 : null,
          }
          status.value = 'downloading'
          return
        }

        if (event.event === 'Progress' && progress.value) {
          const downloadedBytes = progress.value.downloadedBytes + event.data.chunkLength
          const contentLength = progress.value.contentLength
          progress.value = {
            contentLength,
            downloadedBytes,
            percent: contentLength && contentLength > 0
              ? Math.min(100, Math.round((downloadedBytes / contentLength) * 100))
              : null,
          }
          status.value = 'downloading'
          return
        }

        if (event.event === 'Finished' && progress.value) {
          progress.value = {
            contentLength: progress.value.contentLength,
            downloadedBytes: progress.value.contentLength ?? progress.value.downloadedBytes,
            percent: 100,
          }
          status.value = 'installing'
        }
      })

      status.value = 'completed'

      if (!detectWindows()) {
        await relaunch()
      }

      return true
    } catch (error) {
      status.value = 'error'
      errorMessage.value = error instanceof Error ? error.message : String(error)
      return false
    }
  }

  async function runStartupCheck() {
    await initialize()
    if (!supported.value || !settingsStore.settings.appUpdate.autoCheck) return
    await checkForUpdates({ silent: true })
  }

  return {
    availableUpdate,
    currentVersion,
    errorMessage,
    initialized,
    isBusy,
    lastCheckedAt,
    progress,
    status,
    supported,
    checkForUpdates,
    initialize,
    installUpdate,
    runStartupCheck,
  }
})
