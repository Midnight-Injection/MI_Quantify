import { normalizeAgentMaxSteps, runReActLoop, type ReActTool, type ReActToolResult } from '@/agents/core/reactAgent'
import { runDiagnosisAgent } from '@/agents/diagnosisAgent'
import { useSidecar } from '@/composables/useSidecar'
import type {
  AiProvider,
  DiagnosisAgentStep,
  MarketIndex,
  NewsItem,
  SearchProvider,
  SectorData,
  StockListItem,
  Strategy,
} from '@/types'
import type {
  RecommendationCandidate,
  RecommendationLaunchWindow,
  RecommendationPreferences,
  RecommendationResult,
} from '@/types/recommendation'
import { buildRecommendationBasisSummary, getRecommendationMarketLabel } from '@/utils/recommendation'
import { normalizeSecurityCode } from '@/utils/security'

type DiagnosisResult = Awaited<ReturnType<typeof runDiagnosisAgent>>

interface RecommendationResearchState {
  indices: MarketIndex[]
  financialNews: NewsItem[]
  industries: SectorData[]
  concepts: SectorData[]
  stockUniverse: StockListItem[]
  sectorMembers: Record<string, StockListItem[]>
  diagnosisCache: Record<string, DiagnosisResult>
}

interface RecommendationToolContext {
  preferences: RecommendationPreferences
  question: string
  searchProviders?: SearchProvider[] | null
  activeSearchProvider?: SearchProvider | null
  selectedStrategy?: Strategy | null
  maxSteps?: number
  onProgress?: (step: DiagnosisAgentStep) => void
  abortSignal?: AbortSignal
  state: RecommendationResearchState
  provider: AiProvider
}

interface RecommendationFinalAnswerCandidate {
  code?: string
  name?: string
  score?: number
  summary?: string
  shortlistReason?: string
  whySelected?: string[]
  watchPoints?: string[]
  launchWindow?: RecommendationLaunchWindow
}

interface RecommendationFinalAnswer {
  basisSummary?: string[]
  marketSummary?: string
  shortlistCount?: number
  disclaimer?: string
  candidates?: RecommendationFinalAnswerCandidate[]
}

function createAbortError() {
  const error = new Error('AI 任务已停止')
  error.name = 'AbortError'
  return error
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw createAbortError()
  }
}

function uniqueBy<T>(items: T[], keyBuilder: (item: T) => string) {
  const seen = new Set<string>()
  return items.filter((item) => {
    const key = keyBuilder(item)
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function uniqueStrings(values: string[]) {
  return values.filter((value, index) => Boolean(value) && values.indexOf(value) === index)
}

function sanitizeTextList(values: unknown, limit = 6) {
  if (!Array.isArray(values)) return []
  return uniqueStrings(values.map((item) => `${item || ''}`.trim()).filter(Boolean)).slice(0, limit)
}

function normalizeLaunchWindow(input: RecommendationLaunchWindow | undefined, index: number): RecommendationLaunchWindow {
  if (!input?.label || !input.reason?.trim()) {
    throw new Error(`荐股智能体返回的第 ${index + 1} 个候选缺少 launchWindow`)
  }
  if (input.label !== '1-3个交易日' && input.label !== '1-2周' && input.label !== '中线待观察') {
    throw new Error(`荐股智能体返回了无效的启动窗口: ${input.label}`)
  }
  return {
    label: input.label,
    reason: input.reason.trim(),
  }
}

function inferCandidateMarket(code: string, market?: RecommendationPreferences['market']) {
  if (market === 'a' || market === 'hk' || market === 'us') return market
  if (code.length === 5) return 'hk'
  if (/^[A-Z]/.test(code)) return 'us'
  return 'a'
}

function buildCandidate(
  candidate: RecommendationFinalAnswerCandidate,
  result: DiagnosisResult,
  market: RecommendationPreferences['market'],
  index: number,
): RecommendationCandidate {
  if (!candidate.code?.trim()) {
    throw new Error(`荐股智能体返回的第 ${index + 1} 个候选缺少 code`)
  }
  if (!candidate.summary?.trim()) {
    throw new Error(`荐股智能体返回的第 ${index + 1} 个候选缺少 summary`)
  }

  return {
    rank: index + 1,
    code: result.stockInfo.code,
    name: result.stockInfo.name,
    market: inferCandidateMarket(result.stockInfo.code, market),
    score: Number(candidate.score) || Number(result.diagnosis.confidence) || 0,
    summary: candidate.summary.trim(),
    shortlistReason: candidate.shortlistReason?.trim() || '',
    whySelected: sanitizeTextList(candidate.whySelected, 6),
    watchPoints: sanitizeTextList(candidate.watchPoints, 6),
    launchWindow: normalizeLaunchWindow(candidate.launchWindow, index),
    quote: {
      price: result.stockInfo.price,
      changePercent: result.stockInfo.changePercent,
      turnover: result.stockInfo.turnover,
    },
    analysis: result.diagnosis,
    evidence: result.policyEvidence,
    trace: result.trace,
  }
}

function createResearchState(): RecommendationResearchState {
  return {
    indices: [],
    financialNews: [],
    industries: [],
    concepts: [],
    stockUniverse: [],
    sectorMembers: {},
    diagnosisCache: {},
  }
}

export async function runRecommendationAgent(options: {
  preferences: RecommendationPreferences
  provider: AiProvider | null
  searchProviders?: SearchProvider[] | null
  activeSearchProvider?: SearchProvider | null
  selectedStrategy?: Strategy | null
  maxSteps?: number
  onProgress?: (step: DiagnosisAgentStep) => void
  abortSignal?: AbortSignal
}): Promise<RecommendationResult> {
  if (!options.provider) {
    throw new Error('当前未配置 AI 模型，无法生成荐股结果。')
  }

  const { get } = useSidecar()
  const preferences = options.preferences
  const market = preferences.market || 'a'
  const state = createResearchState()

  const context: RecommendationToolContext = {
    preferences,
    question: preferences.lastUserMessage || preferences.originalPrompt || '',
    searchProviders: options.searchProviders,
    activeSearchProvider: options.activeSearchProvider,
    selectedStrategy: options.selectedStrategy,
    maxSteps: options.maxSteps,
    onProgress: options.onProgress,
    abortSignal: options.abortSignal,
    state,
    provider: options.provider,
  }

  const tools: ReActTool<RecommendationToolContext>[] = [
    {
      name: 'load_market_indices',
      description: '读取当前市场核心指数，判断整体风险偏好和强弱环境。',
      inputSchema: { market: 'a|hk|us' },
      execute: async (input) => {
        throwIfAborted(options.abortSignal)
        const targetMarket = String(input.market || market).trim() || market
        const response = await get<{ data: MarketIndex[] }>(`/api/market/indices?market=${targetMarket}`)
        const data = response.data || []
        state.indices = data
        return {
          observation: {
            market: targetMarket,
            items: data.slice(0, 12),
          },
          summary: `已读取 ${targetMarket} 指数 ${data.length} 条`,
          empty: !data.length,
          resultCount: data.length,
          sourceCount: data.length ? 1 : 0,
          retryable: true,
        } satisfies ReActToolResult
      },
    },
    {
      name: 'load_financial_news',
      description: '读取最新财经要闻，辅助识别市场情绪和政策催化。',
      inputSchema: { limit: '返回数量，默认 30' },
      execute: async (input) => {
        throwIfAborted(options.abortSignal)
        const limit = Number(input.limit) || 30
        const response = await get<{ data: NewsItem[] }>(`/api/news/financial?limit=${limit}`)
        const data = response.data || []
        state.financialNews = data
        return {
          observation: {
            items: data.slice(0, limit).map((item) => ({
              title: item.title,
              source: item.source,
              summary: item.aiSummary || item.content || '',
            })),
          },
          summary: `已读取财经要闻 ${data.length} 条`,
          empty: !data.length,
          resultCount: data.length,
          sourceCount: data.length ? 1 : 0,
          retryable: true,
        } satisfies ReActToolResult
      },
    },
    {
      name: 'load_stock_universe',
      description: '按市场读取股票列表，供后续从真实股票池里挑选研究对象。',
      inputSchema: { market: 'a|hk|us', page: '页码', pageSize: '返回数量，建议 60-200' },
      execute: async (input) => {
        throwIfAborted(options.abortSignal)
        const targetMarket = String(input.market || market).trim() || market
        const page = Math.max(1, Number(input.page) || 1)
        const pageSize = Math.min(240, Math.max(20, Number(input.pageSize) || (targetMarket === 'a' ? 120 : 80)))
        const response = await get<{ data: StockListItem[]; total: number }>(
          `/api/market/stocks?market=${targetMarket}&page=${page}&pageSize=${pageSize}`,
        )
        const data = response.data || []
        state.stockUniverse = uniqueBy([...state.stockUniverse, ...data], (item) => item.code)
        return {
          observation: {
            market: targetMarket,
            total: response.total || data.length,
            items: data.slice(0, pageSize).map((item) => ({
              code: item.code,
              name: item.name,
              price: item.price,
              changePercent: item.changePercent,
              turnover: item.turnover,
              sectorTags: item.sectorTags || [],
            })),
          },
          summary: `已读取 ${targetMarket} 股票池 ${data.length} 条`,
          empty: !data.length,
          resultCount: data.length,
          sourceCount: data.length ? 1 : 0,
          retryable: true,
        } satisfies ReActToolResult
      },
    },
    {
      name: 'load_industry_rank',
      description: '读取 A 股行业板块强弱排名，用于识别当前主线行业。',
      inputSchema: { limit: '返回数量，默认 20' },
      execute: async (input) => {
        throwIfAborted(options.abortSignal)
        const limit = Number(input.limit) || 20
        const response = await get<{ data: SectorData[] }>('/api/sector/industry')
        const data = response.data || []
        state.industries = data
        return {
          observation: {
            items: data.slice(0, limit),
          },
          summary: `已读取行业排行 ${data.length} 条`,
          empty: !data.length,
          resultCount: data.length,
          sourceCount: data.length ? 1 : 0,
          retryable: true,
        } satisfies ReActToolResult
      },
    },
    {
      name: 'load_concept_rank',
      description: '读取 A 股概念题材强弱排名，用于识别当前热点概念。',
      inputSchema: { limit: '返回数量，默认 20' },
      execute: async (input) => {
        throwIfAborted(options.abortSignal)
        const limit = Number(input.limit) || 20
        const response = await get<{ data: SectorData[] }>('/api/sector/concept')
        const data = response.data || []
        state.concepts = data
        return {
          observation: {
            items: data.slice(0, limit),
          },
          summary: `已读取概念排行 ${data.length} 条`,
          empty: !data.length,
          resultCount: data.length,
          sourceCount: data.length ? 1 : 0,
          retryable: true,
        } satisfies ReActToolResult
      },
    },
    {
      name: 'load_sector_members',
      description: '按板块代码读取成分股，用于围绕主线板块继续缩小候选范围。',
      inputSchema: { codes: ['板块代码'], pageSize: '返回数量，默认 80' },
      execute: async (input) => {
        throwIfAborted(options.abortSignal)
        const codes = Array.isArray(input.codes)
          ? input.codes.map((item) => `${item || ''}`.trim()).filter(Boolean)
          : []
        const pageSize = Math.min(180, Math.max(20, Number(input.pageSize) || 80))
        if (!codes.length) {
          throw new Error('load_sector_members 需要至少一个板块代码')
        }
        const response = await get<{ data: StockListItem[] }>(
          `/api/sector/members?codes=${encodeURIComponent(codes.join(','))}&pageSize=${pageSize}`,
        )
        const data = response.data || []
        state.sectorMembers[codes.join(',')] = data
        state.stockUniverse = uniqueBy([...state.stockUniverse, ...data], (item) => item.code)
        return {
          observation: {
            codes,
            items: data.slice(0, pageSize).map((item) => ({
              code: item.code,
              name: item.name,
              price: item.price,
              changePercent: item.changePercent,
              turnover: item.turnover,
              sectorTags: item.sectorTags || [],
            })),
          },
          summary: `已读取板块成分股 ${data.length} 条`,
          empty: !data.length,
          resultCount: data.length,
          sourceCount: data.length ? 1 : 0,
          retryable: true,
        } satisfies ReActToolResult
      },
    },
    {
      name: 'diagnose_stock',
      description: '对指定股票执行完整诊股，返回结论、区间、风险和证据摘要。只有在准备把它纳入候选时再调用。',
      inputSchema: {
        code: '股票代码',
        name: '股票名称，可选',
        question: '对该股票的研究要求，可选；不传时按当前筛股偏好生成',
      },
      execute: async (input, toolContext) => {
        throwIfAborted(options.abortSignal)
        const code = normalizeSecurityCode(`${input.code || ''}`.trim())
        if (!code) {
          throw new Error('diagnose_stock 需要有效股票代码')
        }
        const name = `${input.name || ''}`.trim()
        const question = `${input.question || ''}`.trim() || [
          `请研究 ${name || code} 是否适合作为当前 ${getRecommendationMarketLabel(toolContext.preferences.market)} 候选`,
          toolContext.preferences.horizon ? `目标周期为 ${toolContext.preferences.horizon}` : '',
          toolContext.preferences.riskTolerance ? `风险偏好为 ${toolContext.preferences.riskTolerance}` : '',
          toolContext.preferences.themes.length ? `优先关注 ${toolContext.preferences.themes.join('、')}` : '',
          toolContext.preferences.avoidThemes.length ? `回避 ${toolContext.preferences.avoidThemes.join('、')}` : '',
        ].filter(Boolean).join('，')

        const result = await runDiagnosisAgent({
          code,
          question,
          provider: toolContext.provider,
          searchProviders: toolContext.searchProviders,
          activeSearchProvider: toolContext.activeSearchProvider,
          selectedStrategy: toolContext.selectedStrategy,
          resolvedName: name || undefined,
          matchedKeyword: name || code,
          maxSteps: normalizeAgentMaxSteps(toolContext.maxSteps, { min: 3, fallback: 8 }),
          abortSignal: toolContext.abortSignal,
          onProgress: (event) => toolContext.onProgress?.(event.step),
        })

        state.diagnosisCache[result.stockInfo.code] = result
        return {
          observation: {
            code: result.stockInfo.code,
            name: result.stockInfo.name,
            price: result.stockInfo.price,
            changePercent: result.stockInfo.changePercent,
            turnover: result.stockInfo.turnover,
            recommendation: result.diagnosis.recommendation,
            prediction: result.diagnosis.prediction,
            confidence: result.diagnosis.confidence,
            summary: result.diagnosis.summary,
            buyLower: result.diagnosis.buyLower,
            buyUpper: result.diagnosis.buyUpper,
            catalysts: (result.diagnosis.catalysts || []).slice(0, 3),
            risks: (result.diagnosis.risks || []).slice(0, 3),
            evidence: (result.policyEvidence || []).slice(0, 3).map((item) => ({
              title: item.title,
              summary: item.summary,
              source: item.source,
            })),
          },
          summary: `已完成 ${result.stockInfo.name}（${result.stockInfo.code}）诊股`,
          empty: false,
          resultCount: 1,
          sourceCount: (result.policyEvidence || []).length,
          retryable: false,
        } satisfies ReActToolResult
      },
    },
  ]

  const reactResult = await runReActLoop<RecommendationToolContext, RecommendationFinalAnswer>({
    provider: options.provider,
    context,
    tools,
    maxTurns: normalizeAgentMaxSteps(options.maxSteps, { min: 6, fallback: 10 }),
    abortSignal: options.abortSignal,
    requireFinalAnswer: true,
    finalAnswerSchema: {
      basisSummary: ['市场：A股', '周期：短线'],
      marketSummary: '一句话总结当前市场环境和筛选逻辑。',
      shortlistCount: 12,
      disclaimer: '仅供参考，不构成投资建议。',
      candidates: [
        {
          code: '000001',
          name: '示例股票',
          score: 88,
          summary: '为什么它进入最终候选',
          shortlistReason: '候选池入选原因',
          whySelected: ['理由1', '理由2'],
          watchPoints: ['观察点1', '观察点2'],
          launchWindow: {
            label: '1-3个交易日',
            reason: '启动窗口判断依据',
          },
        },
      ],
    },
    planInputSummary: buildRecommendationBasisSummary(preferences).join(' / '),
    planQuery: context.question,
    onProgress: options.onProgress,
    systemPrompt: `你是荐股统一智能体。你必须只基于工具返回的真实市场数据与诊股结果完成候选筛选。

禁止使用任何预打分、固定板块匹配、固定候选池或写死结论。
你必须自己决定下一步调用哪个工具以及参数，每轮只能调用一个工具。
如果准备把某只股票纳入最终候选，必须先调用 diagnose_stock 获取完整诊股结果。
如果当前数据还不足以形成明确候选，继续调用工具；如果已经足够，直接 finish 并返回最终 JSON。
最终候选必须写清楚具体股票、操作建议、观察/介入区间、止损或退出条件、为什么选它，禁止只写“可关注”“有机会”之类模糊结论。`,
    userPrompt: JSON.stringify({
      task: '根据用户偏好生成荐股候选列表。',
      preferences,
      question: context.question,
      requirement: [
        '只允许依据工具返回的真实市场、板块、新闻和诊股数据做判断。',
        '最终候选必须是已经调用 diagnose_stock 研究过的股票。',
        '需要明确给出市场总结、候选原因、观察点、预计启动窗口、具体入场价位和退出条件。',
      ],
    }, null, 2),
    nextStepPrompt: '请判断当前数据是否已足够完成荐股候选列表；如果还不够，继续只调用一个最必要的工具；如果已经足够，直接 finish 并返回最终 JSON。注意候选股票必须先诊股后才能写入最终结果，且每只候选都要写出明确的操作、价位区间和退出条件。',
    toolMaxTokens: 2200,
    toolTimeoutMs: 180000,
  })

  const finalAnswer = reactResult.finalAnswer
  if (!finalAnswer) {
    throw new Error('荐股智能体未返回最终结果')
  }
  if (!finalAnswer.marketSummary?.trim()) {
    throw new Error('荐股智能体未返回 marketSummary')
  }
  if (!finalAnswer.disclaimer?.trim()) {
    throw new Error('荐股智能体未返回 disclaimer')
  }

  const finalCandidates = Array.isArray(finalAnswer.candidates) ? finalAnswer.candidates : []
  const candidates = finalCandidates.map((candidate, index) => {
    const code = candidate.code?.trim()
    if (!code) {
      throw new Error(`荐股智能体返回的第 ${index + 1} 个候选缺少 code`)
    }
    const diagnosis = state.diagnosisCache[normalizeSecurityCode(code)]
    if (!diagnosis) {
      throw new Error(`荐股智能体在未诊股的情况下引用了候选 ${code}`)
    }
    return buildCandidate(candidate, diagnosis, preferences.market, index)
  })

  return {
    preferences,
    basisSummary: finalAnswer.basisSummary?.length
      ? sanitizeTextList(finalAnswer.basisSummary, 12)
      : buildRecommendationBasisSummary(preferences),
    marketSummary: finalAnswer.marketSummary.trim(),
    shortlistCount: Number(finalAnswer.shortlistCount) || state.stockUniverse.length,
    candidates,
    disclaimer: finalAnswer.disclaimer.trim(),
    generatedAt: Date.now(),
  }
}
