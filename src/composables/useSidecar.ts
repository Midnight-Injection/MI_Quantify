import { ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'

const baseUrl = 'http://127.0.0.1:18911'
const running = ref(false)
const requestTimeoutMs = 25000
const inflightGetRequests = new Map<string, Promise<any>>()
let _registeredProxySignature = ''

function buildProxySignature(proxies: {
  id: string
  name: string
  host: string
  port: number
  protocol: string
  username: string
  password: string
  enabled: boolean
}[]) {
  return JSON.stringify(
    [...proxies]
      .map((proxy) => ({
        id: proxy.id,
        name: proxy.name,
        host: proxy.host.trim(),
        port: proxy.port,
        protocol: proxy.protocol,
        username: proxy.username,
        password: proxy.password,
        enabled: proxy.enabled,
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
  )
}

async function syncProxiesToSidecar(proxies: { id: string; name: string; host: string; port: number; protocol: string; username: string; password: string; enabled: boolean }[]) {
  const currentSignature = buildProxySignature(proxies)
  if (currentSignature === _registeredProxySignature) return
  try {
    await post('/api/proxy/register', { proxies })
    _registeredProxySignature = currentSignature
  } catch {}
}

async function start() {
  if (await checkHealth()) {
    running.value = true
    return 'sidecar already healthy'
  }
  try {
    const result = await invoke<string>('sidecar_start')
    running.value = true
    return result
  } catch (e) {
    console.error('[sidecar] start failed:', e)
    throw e
  }
}

async function stop() {
  try {
    const result = await invoke<string>('sidecar_stop')
    running.value = false
    return result
  } catch (e) {
    console.error('[sidecar] stop failed:', e)
    throw e
  }
}

async function status() {
  if (await checkHealth()) {
    running.value = true
    return true
  }
  try {
    const isRunning = await invoke<boolean>('sidecar_status')
    running.value = isRunning
    return isRunning
  } catch {
    running.value = false
    return false
  }
}

async function ensureRunning() {
  const isRunning = await status()
  if (!isRunning) {
    await start()
    await waitForHealth()
  }
}

async function waitForHealth(maxRetries = 10, interval = 1000) {
  for (let i = 0; i < maxRetries; i++) {
    if (await checkHealth()) {
      running.value = true
      return true
    }
    await new Promise((r) => setTimeout(r, interval))
  }
  throw new Error('sidecar health check failed: 请检查本地 Python sidecar 是否已启动、src-python 依赖是否安装完成，以及系统代理 / 网络是否能访问新浪和东方财富接口')
}

async function checkHealth() {
  try {
    const res = await request(`${baseUrl}/health`)
    return res.ok
  } catch {
    return false
  }
}

async function request(input: string, init?: RequestInit) {
  const controller = new AbortController()
  let timedOut = false
  const timeoutId = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, requestTimeoutMs)
  try {
    try {
      return await fetch(input, {
        ...init,
        signal: controller.signal,
      })
    } catch (error) {
      if (timedOut) {
        const timeoutError = new Error(`sidecar request timeout after ${requestTimeoutMs}ms`)
        timeoutError.name = 'TimeoutError'
        throw timeoutError
      }
      throw error
    }
  } finally {
    clearTimeout(timeoutId)
  }
}

function shouldRetrySidecarRequest(error: unknown) {
  if (!(error instanceof Error)) return false
  return error.name === 'AbortError'
    || error.name === 'TimeoutError'
    || /Failed to fetch|NetworkError|Load failed|fetch/i.test(error.message)
}

async function get<T>(path: string): Promise<T> {
  await ensureRunning()
  const key = `${baseUrl}${path}`
  if (inflightGetRequests.has(key)) {
    return inflightGetRequests.get(key) as Promise<T>
  }

  const promise = (async () => {
    try {
      const res = await request(key)
      if (!res.ok) throw new Error(`sidecar request failed: ${res.status}`)
      return res.json()
    } catch (error) {
      if (!shouldRetrySidecarRequest(error)) {
        throw error
      }
      await waitForHealth()
      const retryRes = await request(key)
      if (!retryRes.ok) throw new Error(`sidecar request failed: ${retryRes.status}`)
      return retryRes.json()
    }
  })()

  inflightGetRequests.set(key, promise)

  try {
    return await promise
  } finally {
    inflightGetRequests.delete(key)
  }
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  await ensureRunning()
  const doPost = () => request(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

  let res: Response
  try {
    res = await doPost()
  } catch (error) {
    if (!shouldRetrySidecarRequest(error)) {
      throw error
    }
    await waitForHealth()
    res = await doPost()
  }

  if (!res.ok) {
    const message = await res.text()
    throw new Error(`sidecar request failed: ${res.status} ${message}`)
  }
  return res.json()
}

export function useSidecar() {
  return { running, start, stop, status, ensureRunning, get, post, syncProxiesToSidecar }
}
