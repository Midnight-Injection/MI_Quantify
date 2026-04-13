import { useAiChat } from '@/composables/useAiChat'
import type { AiInsightDigest, AiProvider } from '@/types'

interface InsightPayload {
  title: string
  market: string
  facts: string[]
  news?: string[]
  social?: string[]
  trendHints?: string[]
}

const providerCooldown = new Map<string, number>()
const cooldownStorageKey = 'mi_quantify_ai_insight_cooldown'

function readCooldown(providerId: string) {
  const memoryValue = providerCooldown.get(providerId) || 0
  if (typeof window === 'undefined') {
    return memoryValue
  }

  try {
    const raw = window.localStorage.getItem(cooldownStorageKey)
    if (!raw) return memoryValue
    const parsed = JSON.parse(raw) as Record<string, number>
    return Math.max(memoryValue, parsed[providerId] || 0)
  } catch {
    return memoryValue
  }
}

function writeCooldown(providerId: string, retryAfter: number) {
  providerCooldown.set(providerId, retryAfter)
  if (typeof window === 'undefined') {
    return
  }

  try {
    const raw = window.localStorage.getItem(cooldownStorageKey)
    const parsed = raw ? (JSON.parse(raw) as Record<string, number>) : {}
    parsed[providerId] = retryAfter
    window.localStorage.setItem(cooldownStorageKey, JSON.stringify(parsed))
  } catch {
    // Ignore storage errors and keep the in-memory cooldown.
  }
}

function buildFallbackDigest(payload: InsightPayload): AiInsightDigest {
  const headline = payload.facts[0] || `${payload.title} 暂无足够数据`
  const trendSeed = payload.trendHints?.[0] || '趋势保持观察'
  const newsSeed = payload.news?.[0] || '当前没有补充到新的消息面线索'
  const socialSeed = payload.social?.[0] || '社会面与政策面暂未出现额外冲击'

  return {
    headline,
    summary: `${payload.title} 当前以 ${payload.market} 视角解读，优先看 ${payload.facts.slice(0, 2).join('，')}。`,
    newsView: newsSeed,
    socialView: socialSeed,
    trendView: trendSeed,
    actionView: payload.facts[1] || '先看强弱结构，再决定追踪还是等待。',
    bullets: [...payload.facts, ...(payload.trendHints || [])].slice(0, 4),
    confidenceLabel: payload.facts.length >= 3 ? '中等把握' : '观察期',
    source: 'rule',
    generatedAt: Date.now(),
  }
}

export function useAiInsights() {
  const { chatJson } = useAiChat()

  async function generateDigest(provider: AiProvider | null, payload: InsightPayload): Promise<AiInsightDigest> {
    const fallback = buildFallbackDigest(payload)
    if (!provider) return fallback
    const retryAfter = readCooldown(provider.id)
    if (retryAfter > Date.now()) {
      return fallback
    }

    try {
      const result = await chatJson<AiInsightDigest>(provider, [
        {
          role: 'system',
          content:
            '你是资深中文投资研究助理。请基于用户给出的事实输出通俗、克制、易懂的市场点评。不要承诺收益，不要夸大胜率，只输出 JSON。',
        },
        {
          role: 'user',
          content: JSON.stringify({
            task: '生成简洁的 AI 点评摘要',
            outputSchema: {
              headline: '一句话标题',
              summary: '用 2-3 句说明当前局面',
              newsView: '消息面点评',
              socialView: '政策/社会面点评',
              trendView: '未来趋势点评',
              actionView: '用户可执行建议',
              bullets: ['最多 4 条要点'],
              confidenceLabel: '低/中/高把握',
              source: 'ai',
              generatedAt: Date.now(),
            },
            payload,
          }),
        },
      ], {
        temperature: 0.35,
        maxTokens: 900,
      })

      return {
        ...fallback,
        ...result,
        source: 'ai',
        generatedAt: Date.now(),
      }
    } catch (error) {
      writeCooldown(provider.id, Date.now() + 10 * 60 * 1000)
      console.warn('[ai-insights] fallback:', error)
      return fallback
    }
  }

  return {
    generateDigest,
  }
}
