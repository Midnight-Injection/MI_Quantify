import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useSettingsStore } from '@/stores/settings'

interface RealtimeTaskOptions {
  immediate?: boolean
  intervalMultiplier?: number
  minimumMs?: number
  pauseWhenHidden?: boolean
}

export function useRealtimeTask(
  callback: () => Promise<void> | void,
  options: RealtimeTaskOptions = {},
) {
  const settingsStore = useSettingsStore()
  const timer = ref<ReturnType<typeof setInterval> | null>(null)
  const isRunning = ref(false)
  const isExecuting = ref(false)

  const resolvedInterval = computed(() => {
    const baseSeconds = Math.max(3, settingsStore.settings.dataSource.refreshInterval || 5)
    const multiplier = options.intervalMultiplier ?? 1
    return Math.max(options.minimumMs ?? 3000, baseSeconds * 1000 * multiplier)
  })

  async function execute() {
    if (isExecuting.value) return
    isExecuting.value = true
    try {
      await callback()
    } catch (error) {
      console.error('[realtime-task] failed:', error)
    } finally {
      isExecuting.value = false
    }
  }

  function stop() {
    if (timer.value) {
      clearInterval(timer.value)
      timer.value = null
    }
    isRunning.value = false
  }

  function start(forceImmediate = options.immediate ?? true) {
    stop()
    if (!settingsStore.settings.dataSource.realTimeEnabled) return
    isRunning.value = true
    if (forceImmediate) {
      void execute()
    }
    timer.value = setInterval(() => {
      void execute()
    }, resolvedInterval.value)
  }

  function restart() {
    start(false)
  }

  function handleVisibilityChange() {
    if (!options.pauseWhenHidden) return
    if (document.visibilityState === 'hidden') {
      stop()
      return
    }
    if (settingsStore.settings.dataSource.realTimeEnabled) {
      start(false)
    }
  }

  watch(
    () => [settingsStore.settings.dataSource.realTimeEnabled, settingsStore.settings.dataSource.refreshInterval],
    () => {
      if (!settingsStore.initialized) return
      if (!settingsStore.settings.dataSource.realTimeEnabled) {
        stop()
        return
      }
      restart()
    },
  )

  onUnmounted(() => {
    if (options.pauseWhenHidden) {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
    stop()
  })

  onMounted(() => {
    if (!options.pauseWhenHidden) return
    document.addEventListener('visibilitychange', handleVisibilityChange)
  })

  return {
    isRunning,
    isExecuting,
    resolvedInterval,
    execute,
    start,
    stop,
    restart,
  }
}
