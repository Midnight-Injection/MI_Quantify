import { isAuthError, useAiChat } from '@/composables/useAiChat'
import { useStrategyStore } from '@/stores/strategy'
import type { AiProvider, AskMode, InvestmentPreferences, RecommendationPreferences } from '@/types'
import { buildEmptyInvestmentPreferences } from '@/utils/investment'
import { buildEmptyRecommendationPreferences } from '@/utils/recommendation'

interface RouterPayload {
  mode?: string
  confidence?: number
  isFollowUp?: boolean
  reason?: string
  diagnosis?: {
    stockCode?: string
    stockName?: string
  }
  recommendation?: Partial<RecommendationPreferences>
  investment?: Partial<InvestmentPreferences>
}

export interface ModeRouterResult {
  mode: AskMode
  confidence: number
  isFollowUp: boolean
  reason: string
  diagnosis: {
    stockCode?: string
    stockName?: string
  }
  recommendation: RecommendationPreferences
  investment: InvestmentPreferences
}

function normalizeMode(mode?: string): AskMode | null {
  if (mode === 'diagnosis' || mode === 'recommendation' || mode === 'investment') return mode
  return null
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function sanitizeRecommendation(input: Partial<RecommendationPreferences> | undefined, question: string) {
  const base = buildEmptyRecommendationPreferences()
  return {
    ...base,
    ...input,
    themes: input?.themes?.filter(Boolean) || [],
    avoidThemes: input?.avoidThemes?.filter(Boolean) || [],
    mustInclude: input?.mustInclude?.filter(Boolean) || [],
    mustExclude: input?.mustExclude?.filter(Boolean) || [],
    originalPrompt: question,
    lastUserMessage: question,
  }
}

function sanitizeInvestment(input: Partial<InvestmentPreferences> | undefined, question: string) {
  const base = buildEmptyInvestmentPreferences()
  return {
    ...base,
    ...input,
    allowedProducts: input?.allowedProducts?.filter(Boolean) || [],
    forbiddenProducts: input?.forbiddenProducts?.filter(Boolean) || [],
    originalPrompt: question,
    lastUserMessage: question,
  }
}

export async function routeAskMode(options: {
  question: string
  selectedMode: AskMode
  provider: AiProvider | null
  conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>
  conversationContext?: Record<string, unknown>
  abortSignal?: AbortSignal
}): Promise<ModeRouterResult> {
  if (!options.provider) {
    throw new Error('当前未配置 AI 模型，无法进行模式路由。')
  }

  const history = options.conversationHistory || []
  const strategyStore = useStrategyStore()
  const prompt = strategyStore.getPromptTemplateByCategory('mode_router')?.content?.trim() || ''
  const { chatJson } = useAiChat()

  try {
    const payload = await chatJson<RouterPayload>(options.provider, [
      {
        role: 'system',
        content: `${prompt || '你是模式路由智能体，只返回 JSON。'}

你必须直接判断当前问题属于 diagnosis、recommendation、investment 之一。
如果信息不足，也必须基于现有上下文给出最合理的模式判断，不要编造不存在的依据。
输出 JSON:
{
  "mode":"diagnosis|recommendation|investment",
  "confidence":0.0,
  "isFollowUp":false,
  "reason":"判断原因",
  "diagnosis":{"stockCode":"","stockName":""},
  "recommendation":{"themes":[],"avoidThemes":[],"mustInclude":[],"mustExclude":[]},
  "investment":{"allowedProducts":[],"forbiddenProducts":[]}
}`,
      },
      {
        role: 'user',
        content: JSON.stringify({
          userQuestion: options.question,
          selectedMode: options.selectedMode,
          conversationHistory: history.slice(-10),
          conversationContext: options.conversationContext || {},
        }, null, 2),
      },
    ], {
      temperature: 0.1,
      maxTokens: 800,
      signal: options.abortSignal,
    })

    const mode = normalizeMode(payload.mode)
    if (!mode) {
      throw new Error('模式路由智能体未返回有效模式')
    }

    return {
      mode,
      confidence: clamp(Number(payload.confidence) || 0, 0, 1),
      isFollowUp: typeof payload.isFollowUp === 'boolean' ? payload.isFollowUp : false,
      reason: payload.reason?.trim() || '模式路由智能体未提供原因说明',
      diagnosis: {
        stockCode: payload.diagnosis?.stockCode?.trim() || '',
        stockName: payload.diagnosis?.stockName?.trim() || '',
      },
      recommendation: sanitizeRecommendation(payload.recommendation, options.question),
      investment: sanitizeInvestment(payload.investment, options.question),
    }
  } catch (error) {
    if (isAuthError(error)) throw error
    throw error
  }
}
