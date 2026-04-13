export type SignalType = 'buy' | 'sell' | 'hold'
export type SignalStrength = 'strong' | 'medium' | 'weak'

export interface Strategy {
  id: string
  name: string
  description: string
  category: StrategyCategory
  builtin: boolean
  enabled: boolean
  params: Record<string, unknown>
  notes?: string
  updatedAt?: number
}

export type StrategyCategory = 'trend' | 'mean_reversion' | 'momentum' | 'volume' | 'pattern' | 'fundamental' | 'ai'

export interface Signal {
  id: string
  stockCode: string
  stockName: string
  strategyId: string
  strategyName: string
  type: SignalType
  strength: SignalStrength
  price: number
  targetPrice?: number
  stopLoss?: number
  reason: string
  timestamp: number
}

export interface PromptTemplate {
  id: string
  name: string
  builtin: boolean
  category: PromptCategory
  content: string
  variables: string[]
}

export type PromptCategory = 'daily_eval' | 'buy_signal' | 'sell_signal' | 'news_analysis' | 'custom'

export interface BacktestResult {
  strategyId: string
  stockCode: string
  startDate: string
  endDate: string
  totalReturn: number
  annualizedReturn: number
  maxDrawdown: number
  sharpeRatio: number
  winRate: number
  tradeCount: number
  equityCurve: Array<{ date: string; value: number }>
}

export interface AiEvaluation {
  id: string
  stockCode: string
  stockName: string
  technicalScore: number
  sentimentScore: number
  fundScore: number
  totalScore: number
  recommendation: string
  prediction: string
  supportPrice?: number
  resistancePrice?: number
  reason: string
  timestamp: number
}
