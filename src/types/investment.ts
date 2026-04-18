import type { DiagnosisAgentStep } from './stock'

export type InvestmentContributionMode = 'lump_sum' | 'monthly_sip'
export type InvestmentRisk = 'low' | 'medium' | 'high'
export type InvestmentLiquidityNeed = 'low' | 'medium' | 'high'
export type InvestmentProductCategory = 'deposit' | 'fund' | 'wealth'

export interface InvestmentPreferences {
  bank?: string
  principal?: number
  termMonths?: number
  contributionMode?: InvestmentContributionMode
  monthlyAmount?: number
  riskTolerance?: InvestmentRisk
  liquidityNeed?: InvestmentLiquidityNeed
  allowedProducts: string[]
  forbiddenProducts: string[]
  originalPrompt: string
  lastUserMessage?: string
}

export interface InvestmentCandidate {
  rank: number
  productCode: string
  productName: string
  bank: string
  category: InvestmentProductCategory
  riskLevel: string
  suitabilityScore: number
  benchmarkText?: string
  annualRate?: number
  recentReturn3m?: number
  estimatedProfitMin: number
  estimatedProfitMid: number
  estimatedProfitMax: number
  reason: string
  highlights: string[]
  risks: string[]
  sourceRefs: string[]
}

export interface InvestmentResult {
  preferences: InvestmentPreferences
  basisSummary: string[]
  marketSummary: string
  candidates: InvestmentCandidate[]
  disclaimer: string
  generatedAt: number
  trace: DiagnosisAgentStep[]
}
