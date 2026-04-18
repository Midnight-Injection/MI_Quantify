import { runReActLoop, type ReActTool } from '@/agents/core/reactAgent'
import { useSidecar } from '@/composables/useSidecar'
import { useSettingsStore } from '@/stores/settings'
import { useStrategyStore } from '@/stores/strategy'
import type { AiInsightDigest, AiProvider, DiagnosisAgentStep, SearchProvider } from '@/types'
import { buildDigestTimingPrompt, buildSessionPromptRules, getMarketSessionContext, type MarketSessionContext } from '@/utils/marketSession'
import { normalizeSecurityCode } from '@/utils/security'

interface InsightNewsItem {
  title: string
  source: string
  publishTime: string
  content?: string
}

interface InsightSearchItem {
  title: string
  content: string
  link: string
  media: string
  providerId: string
  providerName: string
}

interface InsightMarketSnapshot {
  marketLabel: string
  dataFreshness?: {
    stockListUpdatedAt?: number
    quotesUpdatedAt?: number
    newsUpdatedAt?: number
  }
  breadth?: {
    advance: number
    decline: number
    flat: number
    total: number
    totalAmount: number
  }
  indices: Array<{
    code: string
    name: string
    price: number
    changePercent: number
    amount: number
  }>
  sectors: Array<{
    name: string
    changePercent: number
    amount: number
    leadingStock: string
  }>
  hotStocks: Array<{
    code: string
    name: string
    price: number
    changePercent: number
    amount: number
    turnover: number
    sectorTags?: string[]
  }>
  fundFlows: Array<{
    code: string
    name: string
    mainNetInflow: number
    mainNetInflowPercent: number
  }>
  watchlist: Array<{
    code: string
    name: string
    price: number
    changePercent: number
  }>
  recommendationCandidates: Array<{
    code: string
    name: string
    latestPrice: number
    changePercent: number
    amount?: number
    turnover?: number
    source: 'hot' | 'watchlist' | 'fundflow'
    quoteTimestamp: number
    quoteAgeMs: number
  }>
  facts: string[]
}

interface InsightPayload {
  title: string
  market: string
  currentTime?: string
  snapshot: InsightMarketSnapshot
  financialNews: InsightNewsItem[]
}

interface InsightContext {
  payload: InsightPayload
  marketSession: MarketSessionContext
}

const INSIGHT_MIN_STOCKS_PER_STYLE = 3
const INSIGHT_ENTRY_PRICE_MAX_DEVIATION = {
  short: 0.12,
  long: 0.2,
}

function normalizeInsightCode(code: string) {
  return normalizeSecurityCode(code).toUpperCase()
}

function extractPriceValues(text: string, latestPrice: number) {
  const raw = `${text || ''}`
  const explicitMatches = [
    ...raw.matchAll(/(\d+(?:\.\d+)?)\s*(?:元|块|附近|一线|上下|区间|到|~|-|—)/g),
  ]
    .map((match) => Number(match[1]))
    .filter((item) => Number.isFinite(item))

  const fallbackMatches = (raw.match(/\d+(?:\.\d+)?/g) || [])
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item))
    .filter((item) => Math.abs(item - latestPrice) / Math.max(latestPrice, 0.01) <= 0.6)

  return [...new Set((explicitMatches.length ? explicitMatches : fallbackMatches).filter((item) => item > 0))]
}

function describeMarket(market: string) {
  if (market === 'hk') return '港股'
  if (market === 'us') return '美股'
  return 'A股'
}

function normalizeSearchProviders(providers: SearchProvider[]) {
  return providers.map((provider) => ({
    id: provider.id,
    name: provider.name,
    provider: provider.provider,
    apiUrl: provider.apiUrl,
    apiKey: provider.apiKey,
    enabled: provider.enabled,
    proxyId: provider.proxyId || '',
  }))
}

function buildPolicyQuery(payload: InsightPayload, session: MarketSessionContext) {
  const marketLabel = describeMarket(payload.market)
  const themes = payload.snapshot.sectors.slice(0, 3).map((item) => item.name).join(' ')
  return `${marketLabel} ${session.targetLabel} 政策 产业 扶持 监管 财政 货币 ${themes}`.trim()
}

function buildGlobalQuery(payload: InsightPayload, session: MarketSessionContext) {
  const marketLabel = describeMarket(payload.market)
  const themes = payload.snapshot.sectors.slice(0, 3).map((item) => item.name).join(' ')
  return `${marketLabel} ${session.targetLabel} 国际消息 美联储 汇率 原油 关税 中东 全球市场 ${themes}`.trim()
}

function sanitizeDigest(result: AiInsightDigest, payload: InsightPayload): AiInsightDigest {
  const candidateMap = new Map(
    (payload.snapshot.recommendationCandidates || []).map((item) => [normalizeInsightCode(item.code), item]),
  )
  const watchStocks = (result.watchStocks || [])
    .filter((item) => item?.name && item?.code)
    .slice(0, 8)
    .map((item) => ({
      name: item.name.trim(),
      code: item.code.trim(),
      style: (item.style === '长线' ? '长线' : '短线') as '短线' | '长线',
      entryPrice: item.entryPrice?.trim() || '等待价格确认',
      exitPrice: item.exitPrice?.trim() || '等待退出条件确认',
      reason: item.reason?.trim() || '等待补充理由',
      riskTip: item.riskTip?.trim() || '留意盘面分歧和消息兑现风险',
    }))
  const shortCount = watchStocks.filter((item) => item.style === '短线').length
  const longCount = watchStocks.filter((item) => item.style === '长线').length

  if (shortCount < INSIGHT_MIN_STOCKS_PER_STYLE || longCount < INSIGHT_MIN_STOCKS_PER_STYLE) {
    throw new Error(`AI 推荐股票数量不足，当前短线 ${shortCount} 只、长线 ${longCount} 只，至少各 ${INSIGHT_MIN_STOCKS_PER_STYLE} 只`)
  }

  if (!candidateMap.size) {
    throw new Error('缺少实时推荐候选池，已禁止 AI 自行发挥推荐价位')
  }

  for (const item of watchStocks) {
    const normalizedCode = normalizeInsightCode(item.code)
    const candidate = candidateMap.get(normalizedCode)
    if (!candidate) {
      throw new Error(`AI 推荐了候选池之外的股票 ${item.name}(${item.code})，已拒绝采用`)
    }

    const entryPrices = extractPriceValues(item.entryPrice, candidate.latestPrice)
    if (!entryPrices.length) {
      throw new Error(`AI 未给出 ${item.name}(${item.code}) 的明确入场价`)
    }

    const exitPrices = extractPriceValues(item.exitPrice, candidate.latestPrice)
    if (!exitPrices.length) {
      throw new Error(`AI 未给出 ${item.name}(${item.code}) 的明确退出价`)
    }

    const maxDeviation = item.style === '长线' ? INSIGHT_ENTRY_PRICE_MAX_DEVIATION.long : INSIGHT_ENTRY_PRICE_MAX_DEVIATION.short
    const outOfRangeEntry = entryPrices.some((price) => Math.abs(price - candidate.latestPrice) / Math.max(candidate.latestPrice, 0.01) > maxDeviation)
    if (outOfRangeEntry) {
      throw new Error(`AI 给出的 ${item.name}(${item.code}) 入场价 ${item.entryPrice} 偏离实时价 ${candidate.latestPrice.toFixed(2)} 过大，已拒绝采用`)
    }
  }

  return {
    ...result,
    headline: result.headline?.trim() || 'AI 市场点评',
    summary: result.summary?.trim() || '暂无摘要',
    newsView: result.newsView?.trim() || '暂无消息面结论。',
    policyView: result.policyView?.trim() || '暂无政策面结论。',
    globalView: result.globalView?.trim() || '暂无国际消息结论。',
    shortTermView: result.shortTermView?.trim() || '暂无短线建议。',
    longTermView: result.longTermView?.trim() || '暂无长线建议。',
    bullets: result.bullets?.filter(Boolean).slice(0, 4) || [],
    focusThemes: (result.focusThemes || [])
      .filter((item) => item?.theme && item?.reason)
      .slice(0, 4)
      .map((item) => ({
        theme: item.theme.trim(),
        reason: item.reason.trim(),
        catalyst: item.catalyst?.trim() || '等待更多催化确认',
      })),
    watchStocks,
    confidenceLabel: result.confidenceLabel?.trim() || '中等把握',
    source: 'ai',
    generatedAt: Date.now(),
    futureOutlook: result.futureOutlook?.trim(),
    keyRisks: result.keyRisks?.filter(Boolean).slice(0, 4) || [],
  }
}

export function useAiInsights() {
  const strategyStore = useStrategyStore()
  const settingsStore = useSettingsStore()
  const { post } = useSidecar()

  async function searchNews(query: string, limit = 10) {
    const payload = await post<{ data: InsightSearchItem[] }>('/api/news/search', {
      query,
      limit,
      providers: normalizeSearchProviders(settingsStore.enabledSearchProviders || []),
    })
    return payload.data || []
  }

  async function generateDigest(
    provider: AiProvider | null,
    payload: InsightPayload,
    options?: { onProgress?: (step: DiagnosisAgentStep) => void; abortSignal?: AbortSignal },
  ): Promise<AiInsightDigest> {
    if (!provider) {
      throw new Error('当前未配置 AI 模型，无法生成首页市场点评。')
    }

    const newsPrompt = strategyStore.getPromptTemplateByCategory('news_analysis')?.content?.trim() || ''
    const dailyPrompt = strategyStore.getPromptTemplateByCategory('daily_eval')?.content?.trim() || ''
    const marketSession = getMarketSessionContext(payload.market)
    const timingPrompt = buildDigestTimingPrompt(marketSession)
    const timingRules = buildSessionPromptRules(marketSession)
    const tools: ReActTool<InsightContext>[] = [
      {
        name: 'load_market_snapshot',
        description: '读取当前首页盘面快照，包括指数、涨跌结构、热点板块、活跃股票、主力资金和观察池。',
        inputSchema: {
          scope: 'overview | sectors | stocks，可选',
        },
        execute: async () => ({
          observation: payload.snapshot,
          summary: `已载入 ${payload.snapshot.indices.length} 个指数、${payload.snapshot.sectors.length} 个热点方向、${payload.snapshot.hotStocks.length} 只活跃股票。`,
        }),
      },
      {
        name: 'load_financial_news',
        description: '读取当前市场的财经快讯流，用来判断消息面催化与盘面是否一致。',
        inputSchema: {
          limit: '返回数量，可选，默认 12',
        },
        execute: async (input) => {
          const limit = Math.max(6, Math.min(Number(input.limit) || 12, 20))
          const observation = payload.financialNews.slice(0, limit)
          return {
            observation,
            summary: `已载入 ${observation.length} 条财经快讯。`,
            empty: !observation.length,
            resultCount: observation.length,
          }
        },
      },
      {
        name: 'load_recommendation_candidates',
        description: '读取允许推荐的实时股票候选池，包含最新价、涨跌幅、成交额、换手率、报价时间戳和来源。推荐股票只能从这里选择。',
        inputSchema: {
          limit: '返回数量，可选，默认 12',
        },
        execute: async (input, context) => {
          const limit = Math.max(6, Math.min(Number(input.limit) || 12, 20))
          const observation = context.payload.snapshot.recommendationCandidates.slice(0, limit)
          if (!observation.length) {
            throw new Error('当前没有可用的实时推荐候选池')
          }
          return {
            observation,
            summary: `已载入 ${observation.length} 只可推荐股票，全部带实时价格与报价时间。`,
            empty: !observation.length,
            resultCount: observation.length,
          }
        },
      },
      {
        name: 'search_policy_updates',
        description: '搜索最新政策面、监管面、产业扶持与行业政策信号。',
        inputSchema: {
          query: '可选，默认自动按当前市场和主线构造查询词',
        },
        execute: async (input, context) => {
          const query = String(input.query || buildPolicyQuery(context.payload, context.marketSession)).trim()
          const observation = await searchNews(query, 10)
          return {
            observation,
            summary: `已检索 ${observation.length} 条政策面结果，查询词：${query}`,
            empty: !observation.length,
            resultCount: observation.length,
            sourceCount: observation.length,
          }
        },
      },
      {
        name: 'search_global_updates',
        description: '搜索国际消息、海外宏观、汇率、利率、能源与地缘线索。',
        inputSchema: {
          query: '可选，默认自动按当前市场和主线构造查询词',
        },
        execute: async (input, context) => {
          const query = String(input.query || buildGlobalQuery(context.payload, context.marketSession)).trim()
          const observation = await searchNews(query, 10)
          return {
            observation,
            summary: `已检索 ${observation.length} 条国际消息结果，查询词：${query}`,
            empty: !observation.length,
            resultCount: observation.length,
            sourceCount: observation.length,
          }
        },
      },
    ]

    const reactResult = await runReActLoop<InsightContext, AiInsightDigest>({
      provider,
      context: { payload, marketSession },
      tools,
      maxTurns: Math.max(4, Math.min(settingsStore.settings.ai.diagnosis.maxSteps || 6, 8)),
      abortSignal: options?.abortSignal,
      onProgress: options?.onProgress,
      requireFinalAnswer: true,
      finalAnswerSchema: {
        headline: '一句话标题',
        summary: '2-3 句概括当前到目标时段的主线和节奏',
        newsView: '消息面对当前盘面的影响',
        policyView: '政策面与监管面对板块的影响',
        globalView: '国际消息、汇率、利率、能源与地缘对市场的影响',
        shortTermView: '短线关注方向、条件和节奏',
        longTermView: '长线关注方向与观察逻辑',
        focusThemes: [
          {
            theme: '板块/主题名',
            reason: '为什么值得关注',
            catalyst: '对应催化或验证条件',
          },
        ],
        watchStocks: [
          {
            name: '股票名',
            code: '股票代码',
            style: '短线|长线',
            entryPrice: '建议关注价位或区间',
            exitPrice: '止盈位、减仓位、跌破离场位或退出条件',
            reason: '纳入观察的原因',
            riskTip: '需要警惕的风险',
          },
        ],
        bullets: ['最多 4 条关键要点'],
        confidenceLabel: '低把握/中等把握/高把握',
        futureOutlook: '严格匹配当前时段的预判',
        keyRisks: ['最多 4 条风险'],
        source: 'ai',
        generatedAt: Date.now(),
      },
      systemPrompt: `你是首页市场点评统一智能体。你必须基于工具返回的真实盘面、财经快讯、政策消息与国际消息生成结论。${timingPrompt}
你不能虚构新闻，不要引用任何预设结论或无关维度来凑结论。
推荐股票只能从 recommendationCandidates 实时候选池里选择，不能新增候选池之外的股票。
如果没有读取 recommendationCandidates，就不要输出任何推荐股票和价位。
你必须明确回答：
1. 当前最值得关注的板块/主题是什么，为什么。
2. 哪些股票值得短线关注，哪些股票更适合长线观察。
3. 每只股票必须给出入场价或区间、退出价或退出条件，并说明为什么买。
4. 当前时段对应的执行节奏是什么。
所有字段必须简洁：
- headline 控制在 28 字以内；
- summary/newsView/policyView/globalView/shortTermView/longTermView/futureOutlook 每项控制在 1-2 句；
- focusThemes 最多 3 个；
- watchStocks 固定输出 6 个，短线 3 个、长线 3 个，不能少；
- bullets 和 keyRisks 最多各 3 条。${dailyPrompt ? `\n\n每日评估模板参考：\n${dailyPrompt}` : ''}${newsPrompt ? `\n\n新闻分析模板参考：\n${newsPrompt}` : ''}`,
      userPrompt: JSON.stringify({
        task: payload.title,
        marketSession,
        timingRules,
        payloadPreview: {
          market: payload.market,
          currentTime: payload.currentTime,
          indexCount: payload.snapshot.indices.length,
          sectorCount: payload.snapshot.sectors.length,
          hotStockCount: payload.snapshot.hotStocks.length,
          financialNewsCount: payload.financialNews.length,
        },
      }, null, 2),
      nextStepPrompt: '请先判断当前证据是否足以回答用户的时段标题、重点板块、候选股票、关注价位、退出价或退出条件、短线与长线逻辑。最终必须给出 3 只短线股票和 3 只长线股票，并且它们都必须来自 recommendationCandidates 实时候选池；如果你还没读取候选池、盘面快照、财经快讯、政策消息、国际消息，就继续选择一个最必要的工具；如果证据已经完整，再 finish 返回最终 JSON。',
      toolMaxTokens: 2800,
    })

    if (!reactResult.finalAnswer) {
      throw new Error('首页市场点评智能体未返回最终结果')
    }

    return sanitizeDigest(reactResult.finalAnswer, payload)
  }

  return {
    generateDigest,
  }
}
