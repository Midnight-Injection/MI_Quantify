import type { AiDiagnosis, DiagnosisEvidence, DiagnosisAgentStep } from './stock'

export type RecommendationMarket = 'a' | 'hk' | 'us'
export type RecommendationHorizon = 'short' | 'swing' | 'mid'
export type RecommendationRisk = 'low' | 'medium' | 'high'
export type RecommendationEntryStyle = 'breakout' | 'pullback' | 'balanced'
export type RecommendationClarifyField = 'market' | 'horizon' | 'riskTolerance'

export interface RecommendationPreferences {
  market?: RecommendationMarket
  horizon?: RecommendationHorizon
  riskTolerance?: RecommendationRisk
  entryStyle?: RecommendationEntryStyle
  themes: string[]
  avoidThemes: string[]
  mustInclude: string[]
  mustExclude: string[]
  originalPrompt: string
  lastUserMessage?: string
}

export interface RecommendationClarifyQuestion {
  field: RecommendationClarifyField
  title: string
  prompt: string
  options: string[]
}

export interface RecommendationLaunchWindow {
  label: '1-3个交易日' | '1-2周' | '中线待观察'
  reason: string
}

export interface RecommendationCandidate {
  rank: number
  code: string
  name: string
  market: RecommendationMarket
  score: number
  summary: string
  shortlistReason: string
  whySelected: string[]
  watchPoints: string[]
  launchWindow: RecommendationLaunchWindow
  quote: {
    price: number
    changePercent: number
    turnover: number
  }
  analysis: AiDiagnosis
  evidence: DiagnosisEvidence[]
  trace: DiagnosisAgentStep[]
}

export interface RecommendationResult {
  preferences: RecommendationPreferences
  basisSummary: string[]
  marketSummary: string
  shortlistCount: number
  candidates: RecommendationCandidate[]
  disclaimer: string
  generatedAt: number
}
