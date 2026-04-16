export interface AiProvider {
  id: string
  name: string
  enabled: boolean
  apiUrl: string
  apiKey: string
  model: string
  maxTokens: number
  temperature: number
  proxyId?: string
}

export interface AiMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface AiChatResponse {
  content: string
  model: string
  usage?: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
  }
}
