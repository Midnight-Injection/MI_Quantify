import { ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import type { AiProvider, AiMessage } from '@/types'

export function useAiChat() {
  const loading = ref(false)
  const error = ref<string | null>(null)

  async function chat(
    provider: AiProvider,
    messages: AiMessage[],
    options?: { temperature?: number; maxTokens?: number },
  ): Promise<string> {
    loading.value = true
    error.value = null
    try {
      const result = await invoke<string>('ai_chat', {
        apiUrl: provider.apiUrl,
        apiKey: provider.apiKey,
        model: provider.model,
        messages,
        temperature: options?.temperature ?? provider.temperature,
        maxTokens: options?.maxTokens ?? provider.maxTokens,
      })
      return result
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      error.value = msg
      throw e
    } finally {
      loading.value = false
    }
  }

  async function chatJson<T = unknown>(
    provider: AiProvider,
    messages: AiMessage[],
    options?: { temperature?: number; maxTokens?: number },
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
    chatJson,
  }
}
