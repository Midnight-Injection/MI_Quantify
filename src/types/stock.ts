export interface Stock {
  code: string
  name: string
  market: 'sh' | 'sz' | 'bj'
}

export interface StockQuote {
  code: string
  name: string
  price: number
  change: number
  changePercent: number
  open: number
  high: number
  low: number
  close: number
  preClose: number
  volume: number
  amount: number
  turnover: number
  timestamp: number
}

export interface KlineData {
  timestamp: number
  open: number
  high: number
  low: number
  close: number
  volume: number
  amount: number
}

export interface SectorData {
  code: string
  name: string
  change?: number
  changePercent: number
  leadingStock: string
  leadingCode?: string
  companyCount?: number
  averagePrice?: number
  volume: number
  amount?: number
}

export interface MarketIndex {
  code: string
  name: string
  price: number
  change: number
  changePercent: number
  volume: number
  amount: number
}

export interface AdvanceDecline {
  advance: number
  decline: number
  flat: number
  total: number
  totalAmount: number
}

export interface StockListItem {
  code: string
  name: string
  price: number
  change: number
  changePercent: number
  open: number
  high: number
  low: number
  preClose: number
  volume: number
  amount: number
  turnover: number
  pe?: number
  pb?: number
  totalMv?: number
  circMv?: number
  sectorTags?: string[]
}

export interface FundFlow {
  code: string
  name: string
  mainNetInflow: number
  mainNetInflowPercent: number
  superLargeNetInflow: number
  largeNetInflow: number
  mediumNetInflow: number
  smallNetInflow: number
}

export interface WatchListStock {
  code: string
  name: string
  addedAt: number
  group?: string
  note?: string
}

export interface StockProfile {
  market: 'sh' | 'sz' | 'bj' | 'hk' | 'us'
  board: string
  lotSize: number
  currency: string
  priceLimitRatio: number
  tags: string[]
}

export interface TechnicalSnapshot {
  ma5: number
  ma10: number
  ma20: number
  ma60: number
  rsi14: number
  dif: number
  dea: number
  macd: number
  avgVolume5: number
  avgVolume20: number
  volumeRatio: number
  supportPrice: number
  resistancePrice: number
  trend: 'bullish' | 'neutral' | 'bearish'
  momentum: 'strong' | 'moderate' | 'weak'
}

export interface AiDiagnosisScenario {
  label: string
  expectedPrice: number
  probabilityHint: string
}

export interface DiagnosisEvidence {
  title: string
  summary: string
  tone?: 'positive' | 'negative' | 'neutral'
  source?: string
}

export interface DiagnosisAgentStep {
  id: string
  kind: 'plan' | 'tool' | 'synthesis'
  title: string
  status: 'running' | 'done' | 'skipped' | 'error'
  tool?: string
  strategy?: string
  query?: string
  inputSummary?: string
  resultSummary?: string
  startedAt: number
  finishedAt: number
  durationMs?: number
}

export interface AiDiagnosis {
  recommendation: string
  prediction: string
  confidence: number
  riskLevel: string
  summary: string
  supportPrice?: number
  resistancePrice?: number
  buyLower?: number
  buyUpper?: number
  sellLower?: number
  sellUpper?: number
  positionAdvice?: string
  positionSize?: string
  entryAdvice?: string
  exitAdvice?: string
  stopLossPrice?: number
  takeProfitPrice?: number
  suggestedShares?: number
  catalysts: string[]
  risks: string[]
  socialSignals: string[]
  scenarios: AiDiagnosisScenario[]
  strategyFocus?: string[]
  evidence?: DiagnosisEvidence[]
  toolCalls?: DiagnosisAgentStep[]
  rawText?: string
  generatedAt: number
}
