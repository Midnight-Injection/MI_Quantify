import { ref, onUnmounted } from 'vue'

export function usePolling(callback: () => Promise<void> | void, intervalMs: number, immediate = true) {
  const timer = ref<ReturnType<typeof setInterval> | null>(null)
  const isRunning = ref(false)

  async function execute() {
    try {
      await callback()
    } catch (e) {
      console.error('[polling] error:', e)
    }
  }

  function start() {
    stop()
    isRunning.value = true
    if (immediate) execute()
    timer.value = setInterval(execute, intervalMs)
  }

  function stop() {
    if (timer.value) {
      clearInterval(timer.value)
      timer.value = null
    }
    isRunning.value = false
  }

  function restart(newInterval?: number) {
    stop()
    if (newInterval !== undefined) intervalMs = newInterval
    start()
  }

  onUnmounted(() => {
    stop()
  })

  return {
    isRunning,
    start,
    stop,
    restart,
  }
}
