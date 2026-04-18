import { runReActLoop, type ReActTool, type ReActToolResult } from '@/agents/core/reactAgent'
import { useSidecar } from '@/composables/useSidecar'
import { useStrategyStore } from '@/stores/strategy'
import type { AiProvider, DiagnosisAgentStep, InvestmentCandidate, InvestmentPreferences, InvestmentResult } from '@/types'
import { buildInvestmentBasisSummary } from '@/utils/investment'

interface DepositRateItem {
  term: string
  annualRate: number
}

interface BankShelfItem {
  productCode: string
  productName: string
  category: 'fund' | 'wealth'
  riskLevel: string
  performanceBenchmark?: string
  feeStandard?: string
  companyName?: string
  salesChannel?: string
  currency?: string
  url?: string
}

interface FundProfile {
  code: string
  name: string
  type?: string
  fee?: string
  unitNav?: number
  cumulativeNav?: number
  dailyGrowthRate?: number
  recentReturn3m?: number
  rating?: {
    fiveStarCount?: number
    morningstarRating?: number
    shanghaiRating?: number
    zhaoshangRating?: number
    manager?: string
    company?: string
    fundType?: string
  }
}

interface ResearchState {
  depositRates: DepositRateItem[]
  depositSourceUrl: string
  depositPublishedAt: string
  bankShelf: BankShelfItem[]
  shelfSourceUrl: string
  officialPages: Array<{ title: string; url: string }>
  fundProfiles: Record<string, FundProfile>
  fundHistories: Record<string, Array<{ date: string; unitNav?: number; cumulativeReturn?: number }>>
}

interface InvestmentToolContext {
  question: string
  preferences: InvestmentPreferences
  state: ResearchState
}

interface InvestmentFinalAnswer {
  basisSummary?: string[]
  marketSummary?: string
  disclaimer?: string
  candidates?: Array<Partial<InvestmentCandidate>>
}

function createState(): ResearchState {
  return {
    depositRates: [],
    depositSourceUrl: '',
    depositPublishedAt: '',
    bankShelf: [],
    shelfSourceUrl: '',
    officialPages: [],
    fundProfiles: {},
    fundHistories: {},
  }
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

function buildQuery(params: Record<string, string | number | boolean | undefined>) {
  const searchParams = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === '') return
    searchParams.set(key, String(value))
  })
  return searchParams.toString()
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

function normalizeCandidateCategory(value: unknown): InvestmentCandidate['category'] {
  if (value === 'deposit' || value === 'fund' || value === 'wealth') return value
  throw new Error(`投资智能体返回了无效产品类别: ${String(value)}`)
}

function normalizeCandidate(candidate: Partial<InvestmentCandidate>, index: number): InvestmentCandidate {
  if (!candidate.productCode?.trim()) {
    throw new Error(`投资智能体返回的第 ${index + 1} 个候选缺少 productCode`)
  }
  if (!candidate.productName?.trim()) {
    throw new Error(`投资智能体返回的第 ${index + 1} 个候选缺少 productName`)
  }
  return {
    rank: index + 1,
    productCode: candidate.productCode.trim(),
    productName: candidate.productName.trim(),
    bank: candidate.bank?.trim() || '',
    category: normalizeCandidateCategory(candidate.category),
    riskLevel: candidate.riskLevel?.trim() || '',
    suitabilityScore: Number(candidate.suitabilityScore) || 0,
    benchmarkText: candidate.benchmarkText?.trim() || undefined,
    annualRate: typeof candidate.annualRate === 'number' ? candidate.annualRate : undefined,
    recentReturn3m: typeof candidate.recentReturn3m === 'number' ? candidate.recentReturn3m : undefined,
    estimatedProfitMin: Number(candidate.estimatedProfitMin) || 0,
    estimatedProfitMid: Number(candidate.estimatedProfitMid) || 0,
    estimatedProfitMax: Number(candidate.estimatedProfitMax) || 0,
    reason: candidate.reason?.trim() || '',
    highlights: sanitizeTextList(candidate.highlights, 6),
    risks: sanitizeTextList(candidate.risks, 6),
    sourceRefs: sanitizeTextList(candidate.sourceRefs, 6),
  }
}

function buildToolSummary(result: ReActToolResult, fallback: string) {
  return result.summary || fallback
}

export async function runInvestmentAgent(options: {
  question: string
  preferences: InvestmentPreferences
  provider: AiProvider | null
  maxSteps?: number
  onProgress?: (step: DiagnosisAgentStep) => void
  abortSignal?: AbortSignal
}): Promise<InvestmentResult> {
  if (!options.provider) {
    throw new Error('当前未配置 AI 模型，无法生成投资方案。')
  }

  const { get } = useSidecar()
  const strategyStore = useStrategyStore()
  const state = createState()
  const preferences: InvestmentPreferences = {
    ...options.preferences,
    bank: options.preferences.bank || '中国银行',
    termMonths: options.preferences.termMonths || 3,
    contributionMode: options.preferences.contributionMode || 'lump_sum',
    allowedProducts: [...(options.preferences.allowedProducts || [])],
    forbiddenProducts: [...(options.preferences.forbiddenProducts || [])],
  }

  const context: InvestmentToolContext = {
    question: options.question,
    preferences,
    state,
  }

  async function requestDepositRates(bank: string) {
    const query = buildQuery({ bank })
    const response = await get<{ data: { items?: DepositRateItem[]; sourceUrl?: string; publishedAt?: string } }>(
      `/api/investment/bank/deposit-rates?${query}`,
    )
    const data = response.data || { items: [] }
    state.depositRates = data.items || []
    state.depositSourceUrl = data.sourceUrl || state.depositSourceUrl
    state.depositPublishedAt = data.publishedAt || state.depositPublishedAt
    return data
  }

  async function requestBankShelf(bank: string, keyword: string, limit = 20) {
    const query = buildQuery({ bank, keyword, limit, includeWealth: true })
    const response = await get<{ data: { items?: BankShelfItem[]; sourceUrl?: string } }>(
      `/api/investment/bank/fund-shelf?${query}`,
    )
    const data = response.data || { items: [] }
    state.bankShelf = uniqueBy(
      [
        ...state.bankShelf,
        ...((data.items || []).map((item) => ({
          ...item,
          riskLevel: String(item.riskLevel || '').replace(/\s+/g, '').trim() || '未披露',
        }))),
      ],
      (item) => `${item.category}:${item.productCode}:${item.productName}`,
    )
    state.shelfSourceUrl = data.sourceUrl || state.shelfSourceUrl
    return data
  }

  async function requestOfficialSearch(bank: string, keyword: string, limit = 8) {
    const query = buildQuery({ bank, keyword, limit })
    const response = await get<{ data: { items?: Array<{ title: string; url: string }> } }>(
      `/api/investment/bank/official-search?${query}`,
    )
    const data = response.data || { items: [] }
    state.officialPages = uniqueBy(
      [...state.officialPages, ...((data.items || []).slice(0, 8))],
      (item) => item.url,
    )
    return data
  }

  async function requestFundSearch(queryText: string, limit = 10) {
    const query = buildQuery({ query: queryText, limit })
    const response = await get<{ data: FundProfile[] }>(`/api/investment/funds/search?${query}`)
    return response.data || []
  }

  async function requestFundProfile(code: string) {
    const response = await get<{ data: FundProfile }>(`/api/investment/funds/profile/${encodeURIComponent(code)}`)
    if (response.data) {
      state.fundProfiles[code] = response.data
    }
    return response.data
  }

  async function requestFundHistory(code: string, limit = 90) {
    const query = buildQuery({ limit })
    const response = await get<{ data: Array<{ date: string; unitNav?: number; cumulativeReturn?: number }> }>(
      `/api/investment/funds/history/${encodeURIComponent(code)}?${query}`,
    )
    state.fundHistories[code] = response.data || []
    return response.data || []
  }

  const tools: ReActTool<InvestmentToolContext>[] = [
    {
      name: 'load_deposit_rates',
      description: '查询指定银行最新官方定期存款挂牌利率，适合做保本基准收益测算。',
      inputSchema: { bank: '银行名称，如中国银行' },
      execute: async (input) => {
        throwIfAborted(options.abortSignal)
        const bank = String(input.bank || preferences.bank || '中国银行').trim()
        const data = await requestDepositRates(bank)
        return {
          observation: {
            bank,
            sourceUrl: data.sourceUrl || '',
            publishedAt: data.publishedAt || '',
            items: (data.items || []).slice(0, 12),
          },
          summary: `已获取 ${bank} 存款利率 ${(data.items || []).length} 条`,
          empty: !(data.items || []).length,
          resultCount: data.items?.length || 0,
          sourceCount: data.sourceUrl ? 1 : 0,
          retryable: !(data.items || []).length,
        } satisfies ReActToolResult
      },
    },
    {
      name: 'search_bank_products',
      description: '查询银行官方代销基金/理财货架，用于获取候选产品、风险等级和业绩比较基准。',
      inputSchema: { bank: '银行名称', keyword: '查询关键词，如货币、债券、理财、指数', limit: '返回数量' },
      execute: async (input) => {
        throwIfAborted(options.abortSignal)
        const bank = String(input.bank || preferences.bank || '中国银行').trim()
        const keyword = String(input.keyword || '').trim()
        const limit = Number(input.limit) || 20
        const data = await requestBankShelf(bank, keyword, limit)
        return {
          observation: {
            bank,
            keyword,
            sourceUrl: data.sourceUrl || '',
            items: (data.items || []).slice(0, limit),
          },
          summary: `官方货架返回 ${(data.items || []).length} 个候选`,
          empty: !(data.items || []).length,
          resultCount: data.items?.length || 0,
          sourceCount: data.sourceUrl ? 1 : 0,
          retryable: true,
        } satisfies ReActToolResult
      },
    },
    {
      name: 'search_bank_official_pages',
      description: '查询银行官网相关页面，辅助确认产品说明页和购买入口。',
      inputSchema: { bank: '银行名称', keyword: '搜索关键词', limit: '返回数量' },
      execute: async (input) => {
        throwIfAborted(options.abortSignal)
        const bank = String(input.bank || preferences.bank || '中国银行').trim()
        const keyword = String(input.keyword || '').trim()
        const limit = Number(input.limit) || 8
        const data = await requestOfficialSearch(bank, keyword, limit)
        return {
          observation: {
            bank,
            keyword,
            items: (data.items || []).slice(0, limit),
          },
          summary: `官网搜索返回 ${(data.items || []).length} 个页面`,
          empty: !(data.items || []).length,
          resultCount: data.items?.length || 0,
          sourceCount: data.items?.length || 0,
          retryable: true,
        } satisfies ReActToolResult
      },
    },
    {
      name: 'search_funds_catalog',
      description: '按基金代码、名称或主题搜索基金基础清单，用于补齐公开基金资料入口。',
      inputSchema: { query: '基金代码、名称或主题关键词', limit: '返回数量' },
      execute: async (input) => {
        throwIfAborted(options.abortSignal)
        const queryText = String(input.query || '').trim()
        const limit = Number(input.limit) || 10
        const data = await requestFundSearch(queryText, limit)
        return {
          observation: {
            query: queryText,
            items: data.slice(0, limit),
          },
          summary: `基金检索返回 ${data.length} 条`,
          empty: !data.length,
          resultCount: data.length,
          sourceCount: data.length ? 1 : 0,
          retryable: true,
        } satisfies ReActToolResult
      },
    },
    {
      name: 'load_fund_profile',
      description: '读取基金基础画像，包括近3个月收益参考和评级摘要。',
      inputSchema: { code: '基金代码' },
      execute: async (input) => {
        throwIfAborted(options.abortSignal)
        const code = String(input.code || '').trim()
        const data = await requestFundProfile(code)
        return {
          observation: data,
          summary: buildToolSummary({
            summary: data ? `已读取基金 ${code} 基础画像` : `未找到基金 ${code}`,
          }, data ? `已读取基金 ${code} 基础画像` : `未找到基金 ${code}`),
          empty: !data,
          resultCount: data ? 1 : 0,
          sourceCount: data ? 1 : 0,
          retryable: false,
        } satisfies ReActToolResult
      },
    },
    {
      name: 'load_fund_history',
      description: '读取基金近3个月净值/累计收益率走势，用于收益测算参考。',
      inputSchema: { code: '基金代码', limit: '最多返回记录数' },
      execute: async (input) => {
        throwIfAborted(options.abortSignal)
        const code = String(input.code || '').trim()
        const limit = Number(input.limit) || 90
        const data = await requestFundHistory(code, limit)
        return {
          observation: {
            code,
            items: data.slice(-Math.min(limit, 90)),
          },
          summary: `已读取基金 ${code} 历史数据 ${data.length} 条`,
          empty: !data.length,
          resultCount: data.length,
          sourceCount: data.length ? 1 : 0,
          retryable: false,
        } satisfies ReActToolResult
      },
    },
  ]

  const prompt = strategyStore.getPromptTemplateByCategory('investment_agent')?.content?.trim() || ''
  const reactResult = await runReActLoop<InvestmentToolContext, InvestmentFinalAnswer>({
    provider: options.provider,
    context,
    tools,
    maxTurns: Math.max(6, Math.min(options.maxSteps || 8, 20)),
    abortSignal: options.abortSignal,
    requireFinalAnswer: true,
    finalAnswerSchema: {
      basisSummary: ['银行：中国银行', '期限：3个月'],
      marketSummary: '基于已读取的官方存款利率、货架产品和基金资料给出总体结论。',
      disclaimer: '仅供参考，不构成投资建议。',
      candidates: [
        {
          productCode: 'string',
          productName: 'string',
          bank: 'string',
          category: 'deposit|fund|wealth',
          riskLevel: 'string',
          suitabilityScore: 80,
          benchmarkText: 'string',
          annualRate: 1.5,
          recentReturn3m: 1.2,
          estimatedProfitMin: 100,
          estimatedProfitMid: 200,
          estimatedProfitMax: 300,
          reason: 'string',
          highlights: ['string'],
          risks: ['string'],
          sourceRefs: ['https://...'],
        },
      ],
    },
    planInputSummary: buildInvestmentBasisSummary(preferences).join(' / '),
    planQuery: options.question,
    onProgress: options.onProgress,
    systemPrompt: `${prompt || '你是投资理财统一智能体。你必须只基于工具返回的真实数据完成研究。'}

禁止使用任何固定排序规则、模板化收益测算或写死候选。
你必须自己决定下一步调用哪个工具以及参数是什么，每轮只能调用一个工具。
如果已有数据已经足以完成用户需求，直接 finish；如果不足，继续选择下一个最必要工具。
如果工具失败，观察失败次数，同一工具失败超过 3 次后不能再调用。
最终输出必须是完整 JSON，结论必须明确说明为什么推荐这些产品、收益区间如何得出、主要风险是什么。`,
    userPrompt: JSON.stringify({
      task: '根据用户需求生成投资理财方案。',
      question: options.question,
      preferences,
      requirement: [
        '只允许依据工具返回的真实官方数据和基金资料做判断。',
        '需要明确给出市场总结、候选方案、收益区间、理由、风险和引用来源。',
        '如果数据不足以支持某个产品，不要虚构收益率或结论。',
      ],
    }, null, 2),
    nextStepPrompt: '请判断当前数据是否已经足以完成投资方案；如果还不够，继续只调用一个最必要的工具；如果已经足够，直接 finish 并返回最终 JSON。注意同一工具失败超过 3 次后不能再调用。',
    toolMaxTokens: 1100,
    toolTimeoutMs: 180000,
  })

  const finalAnswer = reactResult.finalAnswer
  if (!finalAnswer) {
    throw new Error('投资智能体未返回最终方案')
  }
  if (!finalAnswer.marketSummary?.trim()) {
    throw new Error('投资智能体未返回 marketSummary')
  }
  if (!finalAnswer.disclaimer?.trim()) {
    throw new Error('投资智能体未返回 disclaimer')
  }

  const candidates = Array.isArray(finalAnswer.candidates)
    ? finalAnswer.candidates.map((candidate, index) => normalizeCandidate(candidate, index))
    : []

  return {
    preferences,
    basisSummary: finalAnswer.basisSummary?.length
      ? sanitizeTextList(finalAnswer.basisSummary, 12)
      : buildInvestmentBasisSummary(preferences),
    marketSummary: finalAnswer.marketSummary.trim(),
    candidates,
    disclaimer: finalAnswer.disclaimer.trim(),
    generatedAt: Date.now(),
    trace: reactResult.trace,
  }
}
