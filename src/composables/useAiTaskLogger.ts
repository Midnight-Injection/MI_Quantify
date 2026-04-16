import { ref, computed } from 'vue'
import type { DiagnosisAgentStep } from '@/types'

export interface AiTaskLogEntry {
  id: string
  timestamp: number
  message: string
  level: 'info' | 'warn' | 'error' | 'success'
}

export interface AiTask {
  id: string
  title: string
  source: 'home' | 'analysis' | 'stockDetail' | 'ask'
  status: 'running' | 'success' | 'failed' | 'cancelled'
  startedAt: number
  finishedAt?: number
  logs: AiTaskLogEntry[]
  abortController?: AbortController
}

const tasks = ref<AiTask[]>([])
const MAX_TASKS = 50
const MAX_LOGS_PER_TASK = 100

export function useAiTaskLogger() {
  const activeTasks = computed(() => tasks.value.filter((t) => t.status === 'running'))
  const hasActiveTasks = computed(() => activeTasks.value.length > 0)
  const recentTasks = computed(() => [...tasks.value].slice(0, 20))

  function createTask(title: string, source: AiTask['source']): AiTask {
    const task: AiTask = {
      id: `aitask_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      title,
      source,
      status: 'running',
      startedAt: Date.now(),
      logs: [],
      abortController: new AbortController(),
    }
    tasks.value.unshift(task)
    if (tasks.value.length > MAX_TASKS) {
      tasks.value = tasks.value.slice(0, MAX_TASKS)
    }
    return task
  }

  function addLog(taskId: string, message: string, level: AiTaskLogEntry['level'] = 'info') {
    const task = tasks.value.find((t) => t.id === taskId)
    if (!task) return
    task.logs.push({
      id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      timestamp: Date.now(),
      message,
      level,
    })
    if (task.logs.length > MAX_LOGS_PER_TASK) {
      task.logs = task.logs.slice(-MAX_LOGS_PER_TASK)
    }
  }

  function formatProgressMessage(step: DiagnosisAgentStep) {
    const label = step.kind === 'tool' ? `工具 ${step.tool || step.title}` : step.title
    if (step.status === 'running') {
      return step.resultSummary || `正在执行 ${label}...`
    }
    if (step.status === 'error') {
      return `${label}失败：${step.resultSummary || '执行异常'}`
    }
    if (step.status === 'skipped') {
      return `${label}已跳过：${step.resultSummary || '当前阶段未启用'}`
    }
    return `${label}完成：${step.resultSummary || '已完成'}`
  }

  function addProgressLog(taskId: string, step: DiagnosisAgentStep) {
    const task = tasks.value.find((item) => item.id === taskId)
    if (!task) return

    const message = formatProgressMessage(step)
    const level: AiTaskLogEntry['level'] = step.status === 'error'
      ? 'error'
      : step.status === 'skipped'
        ? 'warn'
        : step.status === 'done'
          ? 'success'
          : 'info'
    const lastLog = task.logs[task.logs.length - 1]
    if (lastLog && lastLog.message === message && lastLog.level === level) return
    addLog(taskId, message, level)
  }

  function completeTask(taskId: string, success: boolean, errorMessage?: string) {
    const task = tasks.value.find((t) => t.id === taskId)
    if (!task) return
    task.status = success ? 'success' : 'failed'
    task.finishedAt = Date.now()
    if (errorMessage) {
      task.logs.push({
        id: `log_${Date.now()}`,
        timestamp: Date.now(),
        message: errorMessage,
        level: 'error',
      })
    } else if (success) {
      task.logs.push({
        id: `log_${Date.now()}`,
        timestamp: Date.now(),
        message: '评估完成',
        level: 'success',
      })
    }
  }

  function cancelTask(taskId: string) {
    const task = tasks.value.find((t) => t.id === taskId)
    if (!task || task.status !== 'running') return
    task.abortController?.abort()
    task.status = 'cancelled'
    task.finishedAt = Date.now()
    task.logs.push({
      id: `log_${Date.now()}`,
      timestamp: Date.now(),
      message: '用户取消了评估',
      level: 'warn',
    })
  }

  function cancelAllActiveTasks() {
    for (const task of activeTasks.value) {
      cancelTask(task.id)
    }
  }

  function getTask(taskId: string): AiTask | undefined {
    return tasks.value.find((t) => t.id === taskId)
  }

  function clearTasks() {
    tasks.value = []
  }

  function isTaskCancelled(taskId: string): boolean {
    const task = tasks.value.find((t) => t.id === taskId)
    if (!task) return true
    return task.abortController?.signal.aborted ?? false
  }

  function clearFinishedTasks() {
    tasks.value = tasks.value.filter((t) => t.status === 'running')
  }

  return {
    tasks,
    activeTasks,
    hasActiveTasks,
    recentTasks,
    createTask,
    addLog,
    completeTask,
    cancelTask,
    cancelAllActiveTasks,
    getTask,
    isTaskCancelled,
    clearTasks,
    clearFinishedTasks,
    addProgressLog,
  }
}
