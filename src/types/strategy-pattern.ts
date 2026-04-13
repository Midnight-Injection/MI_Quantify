export interface DataSourceStrategy {
  id: string
  name: string
  type: 'free' | 'paid'
  enabled: boolean
  priority: number

  fetch<T>(path: string): Promise<T>
  healthCheck(): Promise<boolean>
  isAvailable(): boolean
}

export interface LlmProviderStrategy {
  id: string
  name: string
  enabled: boolean
  apiUrl: string
  apiKey: string
  model: string
  maxTokens: number
  temperature: number

  chat(messages: Array<{ role: string; content: string }>): Promise<string>
  chatJson<T>(messages: Array<{ role: string; content: string }>): Promise<T>
  testConnection(): Promise<boolean>
}
