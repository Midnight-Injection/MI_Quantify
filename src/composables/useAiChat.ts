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

export function useAiChat() {
  const loading = ref(false)
  const error = ref<string | null>(null)

  async function chat(
    provider: AiProvider,
    messages: AiMessage[],
    options?: { temperature?: number; maxTokens?: number; signal?: AbortSignal },
  ): Promise<string> {
    loading.value = true
    error.value = null
    try {
      const result = await withAbort(invoke<string>('ai_chat', {
        apiUrl: provider.apiUrl,
        apiKey: provider.apiKey,
        model: provider.model,
        messages,
        temperature: options?.temperature ?? provider.temperature,
        maxTokens: options?.maxTokens ?? provider.maxTokens,
        proxy: resolveProxy(provider),
      }), options?.signal)
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
    options?: { temperature?: number; maxTokens?: number; signal?: AbortSignal },
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

      const result = await withAbort(invoke<string>('ai_chat_stream', {
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
      })

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
    options?: { temperature?: number; maxTokens?: number; signal?: AbortSignal },
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
