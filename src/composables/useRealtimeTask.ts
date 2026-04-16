import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useSettingsStore } from '@/stores/settings'
import { getMarketSessionContext, type MarketCode } from '@/utils/marketSession'

interface RealtimeTaskOptions {
  enabled?: () => boolean
  immediate?: boolean
  intervalMultiplier?: number
  intervalSource?: 'data' | 'ai'
  minimumMs?: number
  pauseWhenHidden?: boolean
  market?: () => MarketCode | MarketCode[] | ''
  skipWhenMarketClosed?: boolean
  closedIntervalMultiplier?: number
}

export function useRealtimeTask(
  callback: () => Promise<void> | void,
  options: RealtimeTaskOptions = {},
) {
  const settingsStore = useSettingsStore()
  const timer = ref<ReturnType<typeof setInterval> | null>(null)
  const isRunning = ref(false)
  const isExecuting = ref(false)
  const isEnabled = computed(() => options.enabled?.() ?? settingsStore.settings.dataSource.realTimeEnabled)

  function resolveMarkets(): MarketCode[] {
    const raw = options.market?.()
    if (!raw) return []
    const values = Array.isArray(raw) ? raw : [raw]
    return Array.from(new Set(values.filter((item): item is MarketCode => item === 'a' || item === 'hk' || item === 'us')))
  }

  function isMarketClosed(): boolean {
    const markets = resolveMarkets()
    if (!markets.length || !options.skipWhenMarketClosed) return false
    return markets.every((market) => getMarketSessionContext(market).phase !== 'trading')
  }

  const resolvedInterval = computed(() => {
    const baseSeconds = options.intervalSource === 'ai'
      ? Math.max(10, settingsStore.settings.ai.autoRunInterval || 45)
      : Math.max(3, settingsStore.settings.dataSource.refreshInterval || 5)
    const multiplier = options.intervalMultiplier ?? 1
    const closedMultiplier = isMarketClosed() ? (options.closedIntervalMultiplier ?? 20) : 1
    return Math.max(options.minimumMs ?? 3000, baseSeconds * 1000 * multiplier * closedMultiplier)
  })

  async function execute() {
    if (isExecuting.value) return
    if (isMarketClosed() && options.skipWhenMarketClosed) {
      return
    }
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
    if (!isEnabled.value) return
    isRunning.value = true
    if (forceImmediate && !(options.skipWhenMarketClosed && isMarketClosed())) {
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
    if (isEnabled.value) {
      start(false)
    }
  }

  watch(
    [isEnabled, resolvedInterval],
    () => {
      if (!settingsStore.initialized) return
      if (!isEnabled.value) {
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
