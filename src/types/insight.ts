export interface AiInsightDigest {
  headline: string
  summary: string
  newsView: string
  socialView: string
  trendView: string
  actionView: string
  bullets: string[]
  confidenceLabel: string
  source: 'ai' | 'rule'
  generatedAt: number
}
