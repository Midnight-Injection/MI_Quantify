import { ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import type { AiProvider, AiMessage, ProxyConfig } from '@/types'
import { useSettingsStore } from '@/stores/settings'

export interface StreamChunkPayload {
  kind: 'delta' | 'reasoning' | 'done' | 'error'
  requestId: string
  content?: string
  fullContent?: string
  message?: string
}

export interface StreamCallbacks {
  onDelta?: (text: string, accumulated: string) => void
  onReasoning?: (text: string) => void
  onDone?: (fullContent: string) => void
  onError?: (message: string) => void
}

function createAbortError() {
  const error = new Error('AI 任务已停止')
  error.name = 'AbortError'
  return error
}

function withLocalTimeout<T>(promise: Promise<T>, ms: number, label: string) {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new Error(`${label} 超时（${Math.round(ms / 1000)}s）`))
    }, ms)

    promise
      .then((value) => {
        window.clearTimeout(timer)
        resolve(value)
      })
      .catch((error) => {
        window.clearTimeout(timer)
        reject(error)
      })
  })
}

function withAbort<T>(promise: Promise<T>, signal?: AbortSignal, cleanup?: () => void): Promise<T> {
  if (!signal) return promise
  if (signal.aborted) {
    cleanup?.()
    return Promise.reject(createAbortError())
  }

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      cleanup?.()
      reject(createAbortError())
    }
    signal.addEventListener('abort', onAbort, { once: true })
    promise
      .then((value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      })
      .catch((error) => {
        signal.removeEventListener('abort', onAbort)
        reject(error)
      })
  })
}

function resolveProxy(provider: AiProvider): ProxyConfig | null {
  if (!provider.proxyId) return null
  const store = useSettingsStore()
  const proxy = store.getProxyById(provider.proxyId)
  if (!proxy || !proxy.enabled || !proxy.host.trim()) return null
  return proxy
}

export function isAuthError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error)
  return /(?:^|\s)(401|403)(?:\s|$|:)/.test(msg)
    || /Unauthorized|Forbidden|令牌已过期|token.*invalid|invalid.*token|authentication/i.test(msg)
}

export function useAiChat() {
  const loading = ref(false)
  const error = ref<string | null>(null)

  async function chat(
    provider: AiProvider,
    messages: AiMessage[],
    options?: { temperature?: number; maxTokens?: number; signal?: AbortSignal; timeoutMs?: number },
  ): Promise<string> {
    loading.value = true
    error.value = null
    try {
      const localTimeoutMs = Math.max(15000, options?.timeoutMs ?? 90000)
      const result = await withLocalTimeout(
        withAbort(invoke<string>('ai_chat', {
          apiUrl: provider.apiUrl,
          apiKey: provider.apiKey,
          model: provider.model,
          messages,
          temperature: options?.temperature ?? provider.temperature,
          maxTokens: options?.maxTokens ?? provider.maxTokens,
          proxy: resolveProxy(provider),
        }), options?.signal),
        localTimeoutMs,
        'AI 响应',
      )
      return result
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      error.value = msg
      throw e
    } finally {
      loading.value = false
    }
  }

  async function chatStream(
    provider: AiProvider,
    messages: AiMessage[],
    callbacks: StreamCallbacks,
    options?: { temperature?: number; maxTokens?: number; signal?: AbortSignal; timeoutMs?: number },
  ): Promise<string> {
    loading.value = true
    error.value = null

    const requestId = `stream_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    let unlisten: UnlistenFn | null = null
    let accumulated = ''
    let aborted = false

    try {
      unlisten = await listen<StreamChunkPayload>('ai-stream-chunk', (event) => {
        if (aborted) return
        const payload = event.payload
        if (payload.requestId !== requestId) return

        if (payload.kind === 'delta' && payload.content) {
          accumulated += payload.content
          callbacks.onDelta?.(payload.content, accumulated)
        } else if (payload.kind === 'reasoning' && payload.content) {
          callbacks.onReasoning?.(payload.content)
        } else if (payload.kind === 'done' && payload.fullContent) {
          accumulated = payload.fullContent
          callbacks.onDone?.(payload.fullContent)
        } else if (payload.kind === 'error' && payload.message) {
          callbacks.onError?.(payload.message)
        }
      })

      const localTimeoutMs = Math.max(15000, options?.timeoutMs ?? 120000)
      const result = await withLocalTimeout(
        withAbort(invoke<string>('ai_chat_stream', {
          requestId,
          apiUrl: provider.apiUrl,
          apiKey: provider.apiKey,
          model: provider.model,
          messages,
          temperature: options?.temperature ?? provider.temperature,
          maxTokens: options?.maxTokens ?? provider.maxTokens,
          proxy: resolveProxy(provider),
        }), options?.signal, () => {
          aborted = true
          unlisten?.()
          unlisten = null
        }),
        localTimeoutMs,
        'AI 流式响应',
      )

      return result
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      error.value = msg
      throw e
    } finally {
      unlisten?.()
      loading.value = false
    }
  }

  async function chatJson<T = unknown>(
    provider: AiProvider,
    messages: AiMessage[],
    options?: { temperature?: number; maxTokens?: number; signal?: AbortSignal; timeoutMs?: number },
  ): Promise<T> {
    const content = await chat(provider, messages, options)
    const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/) || content.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      return JSON.parse(jsonMatch[1] || jsonMatch[0])
    }
    return JSON.parse(content)
  }

  return {
    loading,
    error,
    chat,
    chatStream,
    chatJson,
  }
}
