import { invoke } from '@tauri-apps/api/core'
import type { LlmProviderStrategy } from '@/types/strategy-pattern'
import type { ProxyConfig } from '@/types'
import { useSettingsStore } from '@/stores/settings'

export class OpenAiCompatibleProvider implements LlmProviderStrategy {
  id: string
  name: string
  enabled: boolean
  apiUrl: string
  apiKey: string
  model: string
  maxTokens: number
  temperature: number
  proxyId?: string

  constructor(opts: {
    id: string; name: string; enabled: boolean; apiUrl: string;
    apiKey: string; model: string; maxTokens: number; temperature: number;
    proxyId?: string;
  }) {
    this.id = opts.id
    this.name = opts.name
    this.enabled = opts.enabled
    this.apiUrl = opts.apiUrl
    this.apiKey = opts.apiKey
    this.model = opts.model
    this.maxTokens = opts.maxTokens
    this.temperature = opts.temperature
    this.proxyId = opts.proxyId
  }

  private resolveProxy(): ProxyConfig | null {
    if (!this.proxyId) return null
    const store = useSettingsStore()
    const proxy = store.getProxyById(this.proxyId)
    if (!proxy || !proxy.enabled || !proxy.host.trim()) return null
    return proxy
  }

  async chat(messages: Array<{ role: string; content: string }>): Promise<string> {
    return invoke<string>('ai_chat', {
      apiUrl: this.apiUrl,
      apiKey: this.apiKey,
      model: this.model,
      messages,
      temperature: this.temperature,
      maxTokens: this.maxTokens,
      proxy: this.resolveProxy(),
    })
  }

  async chatJson<T>(messages: Array<{ role: string; content: string }>): Promise<T> {
    const content = await this.chat(messages)
    const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/) || content.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      return JSON.parse(jsonMatch[1] || jsonMatch[0])
    }
    return JSON.parse(content)
  }

  async testConnection(): Promise<boolean> {
    try {
      await invoke<string>('test_ai_connection', {
        apiUrl: this.apiUrl,
        apiKey: this.apiKey,
        model: this.model,
        proxy: this.resolveProxy(),
      })
      return true
    } catch {
      return false
    }
  }
}

export class LlmProviderFactory {
  private static registry = new Map<string, new (opts: any) => LlmProviderStrategy>()

  static register(id: string, providerClass: new (opts: any) => LlmProviderStrategy) {
    LlmProviderFactory.registry.set(id, providerClass)
  }

  static create(opts: {
    id: string; name: string; enabled: boolean; apiUrl: string;
    apiKey: string; model: string; maxTokens: number; temperature: number;
    proxyId?: string;
  }): LlmProviderStrategy {
    const ProviderClass = LlmProviderFactory.registry.get(opts.id) || OpenAiCompatibleProvider
    return new ProviderClass(opts)
  }
}

LlmProviderFactory.register('deepseek', OpenAiCompatibleProvider)
LlmProviderFactory.register('zhipu', OpenAiCompatibleProvider)
LlmProviderFactory.register('qwen', OpenAiCompatibleProvider)
LlmProviderFactory.register('chatgpt', OpenAiCompatibleProvider)
LlmProviderFactory.register('doubao', OpenAiCompatibleProvider)
LlmProviderFactory.register('moonshot', OpenAiCompatibleProvider)
LlmProviderFactory.register('custom', OpenAiCompatibleProvider)
