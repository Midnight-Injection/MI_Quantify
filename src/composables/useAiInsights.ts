import { runReActLoop } from '@/agents/core/reactAgent'
import { useAiChat } from '@/composables/useAiChat'
import { useStrategyStore } from '@/stores/strategy'
import type { AiInsightDigest, AiProvider, DiagnosisAgentStep } from '@/types'
import { buildDigestTimingPrompt, buildSessionPromptRules, getMarketSessionContext } from '@/utils/marketSession'

interface InsightPayload {
  title: string
  market: string
  facts: string[]
  news?: string[]
  social?: string[]
  trendHints?: string[]
  currentTime?: string
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

function extractFromFacts(facts: string[], keywords: string[]): string {
  for (const kw of keywords) {
    const found = facts.find(f => f.includes(kw))
    if (found) return found
  }
  return ''
}

function buildFallbackOutlook(payload: InsightPayload): string {
  const facts = payload.facts
  const news = payload.news || []
  const social = payload.social || []
  const session = getMarketSessionContext(payload.market)
  const period = session.phaseLabel
  const target = session.targetLabel

  const narrative = facts[0] || ''
  const hasStrong = narrative.includes('领涨') || narrative.includes('偏强') || narrative.includes('risk-on')
  const hasWeak = narrative.includes('承压') || narrative.includes('偏弱') || narrative.includes('risk-off')

  const indexFact = extractFromFacts(facts, ['当前', '指数'])
  const sectorFact = extractFromFacts(facts, ['板块热度', '主题热度'])
  const hotFact = extractFromFacts(facts, ['热点股', '次强股'])

  let direction: string
  let reason: string

  if (hasStrong) {
    direction = '上涨或偏强震荡'
    const sectorName = sectorFact.match(/领先的是 (.+)/)?.[1] || '主线板块'
    const stockName = hotFact.match(/以 (.+) 为代表/)?.[1] || '龙头股'
    reason = `${sectorName}持续领涨，${stockName}同步偏强，上涨家数明显多于下跌家数`
    if (social.length >= 2) reason += `，且政策面有 ${social.length} 条正向催化（${social.slice(0, 2).map(s => s.split('：')[0]).join('、')}）正在发酵`
  } else if (hasWeak) {
    direction = '下跌或偏弱调整'
    reason = '指数承压、上涨覆盖不足'
    if (news.length >= 3) reason += `，消息面虽有 ${news.length} 条快讯但尚未形成有效催化`
  } else {
    direction = '震荡整理，方向待定'
    reason = '多空力量接近均衡，指数和板块没有明确共振'
  }

  let actionHint: string
  if (hasStrong) {
    actionHint = '操作上建议围绕强势主线低吸，不宜追高；若后续量能明显萎缩，则需优先防冲高回落。'
  } else if (hasWeak) {
    actionHint = `${target}建议先控仓位观望，等指数止跌或消息面出现新催化再考虑进场。`
  } else {
    actionHint = `${target}重点看主线板块是否放量突破，确认方向后再跟进。`
  }

  return `【${period}预判${target}走势】预计${target}${direction}。依据：${reason}。${actionHint}`
}

function buildFallbackAction(payload: InsightPayload): string {
  const facts = payload.facts
  const social = payload.social || []
  const session = getMarketSessionContext(payload.market)
  const target = session.targetLabel
  const hasStrong = facts.some(f => f.includes('领涨') || f.includes('偏强'))
  const hasWeak = facts.some(f => f.includes('承压') || f.includes('偏弱'))
  const sectors = social
    .map((item) => item.split('：')[0]?.trim())
    .filter(Boolean)
    .slice(0, 2)
    .join('、') || '当前主线板块'

  if (hasStrong) {
    return `当前盘面偏强，${target}优先执行 ${sectors} 的龙头低吸或回踩承接策略。短线严格设止损，放量冲高不追。`
  }
  if (hasWeak) {
    return `盘面承压，${target}建议收缩仓位、降低操作频率，回避高位题材，优先观察 ${sectors} 是否先出现止跌修复。若持有强势股可设跟踪止盈，未企稳前不主动追涨。`
  }
  return `${target}预计仍以震荡为主，先确认指数与 ${sectors} 是否形成量价共振，再决定低吸跟进还是继续等待。不追杂波、不追冲高回落。`
}

function buildFallbackRisks(payload: InsightPayload): string[] {
  const facts = payload.facts
  const risks: string[] = []
  const narrative = facts[0] || ''

  if (narrative.includes('震荡') || narrative.includes('整理')) {
    risks.push('方向不明，假突破风险较高')
  }
  if (narrative.includes('偏强') || narrative.includes('领涨')) {
    risks.push('缩量冲高后可能回落')
  }
  if (narrative.includes('承压') || narrative.includes('偏弱')) {
    risks.push('弱势可能延续，反弹或为诱多')
  }
  const social = payload.social || []
  if (social.length < 2) {
    risks.push('消息面催化不足，持续性存疑')
  }
  if (facts.some(f => f.includes('成交额') || f.includes('量'))) {
    const amountFact = facts.find(f => f.includes('两市成交额'))
    if (amountFact && amountFact.includes('亿')) {
      const match = amountFact.match(/([\d.]+)亿/)
      if (match && parseFloat(match[1]) < 10000) {
        risks.push('两市成交额偏低，反弹力度可能受限')
      }
    }
  }

  if (risks.length === 0) risks.push('量能持续性待验证')
  return risks.slice(0, 3)
}

function buildFallbackDigest(payload: InsightPayload): AiInsightDigest {
  const session = getMarketSessionContext(payload.market)
  const headline = payload.facts[0] || `${payload.title} 暂无足够数据`
  const trendSeed = payload.trendHints?.[0] || '趋势保持观察'
  const newsSeed = payload.news?.[0] || '当前没有补充到新的消息面线索'
  const socialSeed = payload.social?.[0] || '社会面与政策面暂未出现额外冲击'

  return {
    headline,
    summary: `${payload.title} 当前以 ${session.marketLabel}${session.phaseLabel} 视角解读，优先看 ${payload.facts.slice(0, 2).join('，')}。`,
    newsView: newsSeed,
    socialView: socialSeed,
    trendView: trendSeed,
    actionView: buildFallbackAction(payload),
    bullets: [...payload.facts, ...(payload.trendHints || [])].slice(0, 4),
    confidenceLabel: payload.facts.length >= 3 ? '中等把握' : '观察期',
    source: 'rule',
    generatedAt: Date.now(),
    futureOutlook: buildFallbackOutlook(payload),
    keyRisks: buildFallbackRisks(payload),
  }
}

export function useAiInsights() {
  const { chatJson } = useAiChat()
  const strategyStore = useStrategyStore()

  async function generateDigest(
    provider: AiProvider | null,
    payload: InsightPayload,
    options?: { onProgress?: (step: DiagnosisAgentStep) => void; abortSignal?: AbortSignal },
  ): Promise<AiInsightDigest> {
    const fallback = buildFallbackDigest(payload)
    const newsPrompt = strategyStore.getPromptTemplateByCategory('news_analysis')?.content?.trim() || ''
    const dailyPrompt = strategyStore.getPromptTemplateByCategory('daily_eval')?.content?.trim() || ''
    const marketSession = getMarketSessionContext(payload.market)
    const timingPrompt = buildDigestTimingPrompt(marketSession)
    const timingRules = buildSessionPromptRules(marketSession)
    if (!provider) return fallback
    const retryAfter = readCooldown(provider.id)
    if (retryAfter > Date.now()) {
      return fallback
    }

    try {
      const reactContext = { loaded: false }
      const reactResult = await runReActLoop({
        provider,
        context: reactContext,
        maxTurns: 2,
        abortSignal: options?.abortSignal,
        onProgress: options?.onProgress,
        systemPrompt: `你是首页市场点评统一智能体。你的任务是先确认是否已经读取足够的盘面快照，再决定是否可以开始总结。
你不能虚构事实，必须先调用读取快照工具。`,
        userPrompt: JSON.stringify({
          task: '生成首页市场点评前，先读取当前市场快照。',
          marketSession,
          timingRules,
          payloadPreview: {
            title: payload.title,
            market: payload.market,
            factCount: payload.facts.length,
            newsCount: payload.news?.length || 0,
            socialCount: payload.social?.length || 0,
            trendHintCount: payload.trendHints?.length || 0,
          },
        }, null, 2),
        tools: [
          {
            name: 'load_market_snapshot',
            description: '读取首页市场概览、消息列表、社会面催化和趋势提示。',
            execute: async () => {
              reactContext.loaded = true
              return {
                observation: payload,
                summary: `已载入 ${payload.facts.length} 条市场事实、${payload.news?.length || 0} 条新闻和 ${payload.social?.length || 0} 条社会面线索`,
              }
            },
          },
        ],
      })

      const synthesisStarted = Date.now()
      options?.onProgress?.({
        id: `home_synthesis_${synthesisStarted}`,
        kind: 'synthesis',
        title: '首页 AI 汇总',
        status: 'running',
        strategy: 'LLM Synthesis',
        resultSummary: '正在生成首页市场点评...',
        startedAt: synthesisStarted,
        finishedAt: synthesisStarted,
        durationMs: 0,
      })

      const result = await chatJson<AiInsightDigest>(provider, [
        {
          role: 'system',
          content:
            `你是资深中文投资研究助理。请基于用户给出的事实输出通俗、克制、易懂但方向明确的市场点评。不要承诺收益，不要夸大胜率，只输出 JSON。${timingPrompt} futureOutlook 必须非常具体明确，开头必须带上当前市场与时段，例如【A股盘前预判今日走势】、【港股盘中评估午后走势】、【美股盘后预判下一交易日】、【A股休市预判下一次开盘日】。你必须明确写出预计涨 / 预计跌 / 预计震荡三选一，必须结合具体数据（涨跌家数、成交额、板块名称、龙头名称）和具体消息面（政策名、事件名），并在 actionView 或 futureOutlook 中明确点名 1-3 个值得关注的板块/主题及操作方式。首句必须服从当前市场时段，不得先写错时段动作。不要用“可能”“或许”“需要关注”等模糊词。${dailyPrompt ? `\n\n以下是当前启用的每日评估模板，可作为语气和分析维度参考：\n${dailyPrompt}` : ''}${newsPrompt ? `\n\n以下是当前启用的新闻分析模板，可作为消息拆解框架参考：\n${newsPrompt}` : ''}`,
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
              actionView: '用户可执行建议，必须带具体板块/主题和操作动作',
              bullets: ['最多 4 条要点'],
              confidenceLabel: '低/中/高把握',
              futureOutlook: '结合消息面+大盘强度的未来走势预判，必须严格匹配当前市场时段，2-3句，必须包含方向判断（预计涨/预计跌/预计震荡）、具体依据和板块建议',
              keyRisks: ['最多 3 条需要警惕的风险点'],
              source: 'ai',
              generatedAt: Date.now(),
            },
            marketSession,
            timingRules,
            reactTrace: reactResult.trace.map((item) => ({
              tool: item.tool,
              status: item.status,
              summary: item.resultSummary,
            })),
            payload,
          }),
        },
      ], {
        temperature: 0.25,
        maxTokens: 1200,
        signal: options?.abortSignal,
      })

      options?.onProgress?.({
        id: `home_synthesis_${synthesisStarted}`,
        kind: 'synthesis',
        title: '首页 AI 汇总',
        status: 'done',
        strategy: 'LLM Synthesis',
        resultSummary: '首页市场点评生成完成',
        startedAt: synthesisStarted,
        finishedAt: Date.now(),
        durationMs: Date.now() - synthesisStarted,
      })

      return {
        ...fallback,
        ...result,
        source: 'ai',
        generatedAt: Date.now(),
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw error
      }
      if (!(error instanceof Error) || error.name !== 'AbortError') {
        options?.onProgress?.({
          id: `home_synthesis_error_${Date.now()}`,
          kind: 'synthesis',
          title: '首页 AI 汇总',
          status: 'error',
          strategy: 'Fallback Synthesis',
          resultSummary: error instanceof Error ? error.message : String(error),
          startedAt: Date.now(),
          finishedAt: Date.now(),
          durationMs: 0,
        })
      }
      writeCooldown(provider.id, Date.now() + 10 * 60 * 1000)
      console.warn('[ai-insights] fallback:', error)
      return fallback
    }
  }

  return {
    generateDigest,
  }
}
