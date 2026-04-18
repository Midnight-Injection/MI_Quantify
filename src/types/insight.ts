export interface AiInsightDigest {
  headline: string
  summary: string
  newsView: string
  policyView: string
  globalView: string
  shortTermView: string
  longTermView: string
  focusThemes: Array<{
    theme: string
    reason: string
    catalyst: string
  }>
  watchStocks: Array<{
    name: string
    code: string
    style: '短线' | '长线'
    entryPrice: string
    exitPrice: string
    reason: string
    riskTip: string
  }>
  bullets: string[]
  confidenceLabel: string
  source: 'ai' | 'rule'
  generatedAt: number
  futureOutlook?: string
  keyRisks?: string[]
}
