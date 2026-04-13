import type { DataSourceStrategy } from '@/types/strategy-pattern'

export class SidecarDataSource implements DataSourceStrategy {
  id: string
  name: string
  type: 'free' | 'paid'
  enabled: boolean
  priority: number
  private baseUrl: string

  constructor(opts: { id: string; name: string; type: 'free' | 'paid'; enabled: boolean; priority: number; baseUrl: string }) {
    this.id = opts.id
    this.name = opts.name
    this.type = opts.type
    this.enabled = opts.enabled
    this.priority = opts.priority
    this.baseUrl = opts.baseUrl
  }

  async fetch<T>(path: string): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`)
    if (!res.ok) throw new Error(`DataSource ${this.id} request failed: ${res.status}`)
    return res.json()
  }

  async healthCheck(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/health`)
      return res.ok
    } catch {
      return false
    }
  }

  isAvailable(): boolean {
    return this.enabled
  }
}

export class PaidApiDataSource implements DataSourceStrategy {
  id: string
  name: string
  type: 'paid'
  enabled: boolean
  priority: number
  private apiUrl: string
  private apiKey: string = ''
  private apiSecret: string = ''

  constructor(opts: { id: string; name: string; enabled: boolean; priority: number; apiUrl: string; apiKey?: string; apiSecret?: string }) {
    this.id = opts.id
    this.name = opts.name
    this.type = 'paid'
    this.enabled = opts.enabled
    this.priority = opts.priority
    this.apiUrl = opts.apiUrl
    if (opts.apiKey) this.apiKey = opts.apiKey
    if (opts.apiSecret) this.apiSecret = opts.apiSecret
  }

  setCredentials(apiKey: string, apiSecret?: string) {
    this.apiKey = apiKey
    if (apiSecret) this.apiSecret = apiSecret
  }

  async fetch<T>(path: string): Promise<T> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (this.apiKey) headers['Authorization'] = `Bearer ${this.apiKey}`
    const res = await fetch(`${this.apiUrl}${path}`, { headers })
    if (!res.ok) throw new Error(`DataSource ${this.id} request failed: ${res.status}`)
    return res.json()
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.fetch('/health')
      return true
    } catch {
      return false
    }
  }

  isAvailable(): boolean {
    return this.enabled && !!this.apiKey
  }
}
