export type SentimentType = 'positive' | 'negative' | 'neutral'

export interface NewsItem {
  id: string
  title: string
  content: string
  source: string
  url: string
  publishTime: string
  timestamp: number
  relatedStocks: string[]
  sentiment?: SentimentType
  sentimentScore?: number
  aiSummary?: string
}

export interface NewsSource {
  id: string
  name: string
  enabled: boolean
  icon?: string
}
