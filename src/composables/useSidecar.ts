import { ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'

const baseUrl = 'http://127.0.0.1:18911'
const running = ref(false)
const requestTimeoutMs = 25000
const inflightGetRequests = new Map<string, Promise<any>>()
let _registeredProxySignature = ''
let _registeredDataSourceSignature = ''
const EXPECTED_SIDECAR_VERSION = '0.2.1'

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

function buildDataSourceSignature(sources: {
  id: string
  name: string
  enabled: boolean
  priority: number
  apiUrl: string
  apiKey: string
  proxyId?: string
}[]) {
  return JSON.stringify(
    [...sources]
      .map((source) => ({
        id: source.id,
        name: source.name,
        enabled: source.enabled,
        priority: source.priority,
        apiUrl: source.apiUrl.trim(),
        apiKey: source.apiKey ? '***' : '',
        proxyId: source.proxyId || '',
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

async function syncDataSourcesToSidecar(sources: { id: string; name: string; enabled: boolean; type: string; priority: number; apiUrl: string; apiKey: string; apiSecret: string; mode?: string; coverage?: string; proxyId?: string }[]) {
  const currentSignature = buildDataSourceSignature(sources)
  if (currentSignature === _registeredDataSourceSignature) return
  try {
    await post('/api/datasource/register', { sources })
    _registeredDataSourceSignature = currentSignature
  } catch {}
}

async function start() {
  const healthVersion = await checkHealth()
  if (healthVersion) {
    running.value = true
    return 'sidecar already healthy'
  }
  try { await invoke<string>('sidecar_stop') } catch {}
  try { await invoke<string>('sidecar_kill_port') } catch {}
  await new Promise(r => setTimeout(r, 500))
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

async function ensureRunning(signal?: AbortSignal) {
  if (signal?.aborted) throw signal.reason || new DOMException('Aborted', 'AbortError')
  const isRunning = await status()
  if (!isRunning) {
    await start()
    await waitForHealth(signal)
  }
}

async function waitForHealth(signal?: AbortSignal, maxRetries = 10, interval = 1000) {
  for (let i = 0; i < maxRetries; i++) {
    if (signal?.aborted) throw signal.reason || new DOMException('Aborted', 'AbortError')
    if (await checkHealth()) {
      running.value = true
      return true
    }
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, interval)
      if (signal) {
        const onAbort = () => {
          clearTimeout(timer)
          reject(signal.reason || new DOMException('Aborted', 'AbortError'))
        }
        signal.addEventListener('abort', onAbort, { once: true })
      }
    })
  }
  throw new Error('sidecar health check failed: 请检查本地 Python sidecar 是否已启动、src-python 依赖是否安装完成，以及系统代理 / 网络是否能访问新浪和东方财富接口')
}

async function checkHealth(): Promise<string | null> {
  try {
    const res = await request(`${baseUrl}/health`)
    if (!res.ok) return null
    const data = await res.json()
    if (data.version === EXPECTED_SIDECAR_VERSION) return data.version
    console.warn(`[sidecar] version mismatch: got ${data.version}, expected ${EXPECTED_SIDECAR_VERSION}`)
    return null
  } catch {
    return false as unknown as string | null
  }
}

async function request(input: string, init?: RequestInit, signal?: AbortSignal) {
  const controller = new AbortController()
  let timedOut = false
  const timeoutId = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, requestTimeoutMs)

  if (signal) {
    if (signal.aborted) {
      clearTimeout(timeoutId)
      throw signal.reason || new DOMException('Aborted', 'AbortError')
    }
    const onExternalAbort = () => controller.abort()
    signal.addEventListener('abort', onExternalAbort, { once: true })
  }

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
      if (signal?.aborted && !timedOut) {
        const abortError = new DOMException('Aborted', 'AbortError')
        throw abortError
      }
      throw error
    }
  } finally {
    clearTimeout(timeoutId)
  }
}

function shouldRetrySidecarRequest(error: unknown) {
  if (!(error instanceof Error)) return false
  if (error instanceof DOMException && error.name === 'AbortError') return false
  return error.name === 'AbortError'
    || error.name === 'TimeoutError'
    || /Failed to fetch|NetworkError|Load failed|fetch/i.test(error.message)
}

async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  await ensureRunning(signal)
  const key = `${baseUrl}${path}`
  if (inflightGetRequests.has(key)) {
    return inflightGetRequests.get(key) as Promise<T>
  }

  const promise = (async () => {
    try {
      const res = await request(key, undefined, signal)
      if (!res.ok) throw new Error(`sidecar request failed: ${res.status}`)
      return res.json()
    } catch (error) {
      if (!shouldRetrySidecarRequest(error)) {
        throw error
      }
      await waitForHealth(signal)
      const retryRes = await request(key, undefined, signal)
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

async function post<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  await ensureRunning(signal)
  const doPost = () => request(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  }, signal)

  let res: Response
  try {
    res = await doPost()
  } catch (error) {
    if (!shouldRetrySidecarRequest(error)) {
      throw error
    }
    await waitForHealth(signal)
    res = await doPost()
  }

  if (!res.ok) {
    const message = await res.text()
    throw new Error(`sidecar request failed: ${res.status} ${message}`)
  }
  return res.json()
}

export function useSidecar() {
  return { running, start, stop, status, ensureRunning, get, post, syncProxiesToSidecar, syncDataSourcesToSidecar }
}
