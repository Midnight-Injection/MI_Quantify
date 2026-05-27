import { normalizeAgentMaxSteps, runReActLoop, type ReActTool, type ReActToolResult } from '@/agents/core/reactAgent'
import { useSidecar } from '@/composables/useSidecar'
import { useStrategyStore } from '@/stores/strategy'
import type { AiInsightDigest, AiProvider, DiagnosisAgentStep, SearchProvider } from '@/types'
import { buildDigestTimingPrompt, buildSessionPromptRules, getMarketSessionContext, type MarketSessionContext } from '@/utils/marketSession'

interface MarketDigestState {
  overview: Record<string, any> | null
  fundflow: Record<string, any> | null
  sectors: Record<string, any> | null
  hotStocks: Record<string, any> | null
  news: Array<{ title: string; source: string; publishTime: string; content?: string }>
  watchlistQuotes: Array<{ code: string; name: string; price: number; changePercent: number }>
  klineData: Record<string, any[]>
  stockInfo: Record<string, any>
  fundFlowRank: Array<Record<string, any>>
  advanceDecline: Record<string, any> | null
  policySearch: Array<Record<string, any>>
  globalSearch: Array<Record<string, any>>
}

interface MarketDigestContext {
  title: string
  market: string
  currentTime: string
  marketSession: MarketSessionContext
  watchlistCodes: string[]
  state: MarketDigestState
  searchProviders: SearchProvider[]
}

const MARKET_DIGEST_FINAL_SCHEMA = {
  headline: '一句话标题',
  summary: '2-3 句概括当前到目标时段的自主判断、主线假设和执行节奏',
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
      entryPrice: '精确建仓价，如"25.30元"，禁止用区间',
      addPrice: '精确加仓价，如"回踩24.80元不破可加仓"',
      stopLoss: '精确止损价，如"跌破24.50元止损"',
      exitPrice: '精确目标价，如"第一目标27.00元，第二目标28.50元"',
      positionSize: '仓位建议，如"1/3仓试探"或"半仓"',
      reason: '纳入观察的原因，必须包含技术面+资金面/消息面理由',
      riskTip: '最关键的一条风险',
      t0Strategy: '做T策略，如"冲高26元先卖1/3，回落25元接回"',
      timeWindow: '执行时间窗，如"10:00-10:30站稳25.3元执行"',
    },
  ],
  bullets: ['最多 4 条关键要点'],
  confidenceLabel: '低把握/中等把握/高把握',
  futureOutlook: '严格匹配当前时段的预判',
  keyRisks: ['最多 4 条风险'],
  source: 'ai',
  generatedAt: Date.now(),
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

function sanitizeDigest(result: AiInsightDigest): AiInsightDigest {
  const watchStocks = (result.watchStocks || [])
    .filter((item) => item?.name && item?.code)
    .slice(0, 8)
    .map((item) => ({
      name: item.name.trim(),
      code: item.code.trim(),
      style: (item.style === '长线' ? '长线' : '短线') as '短线' | '长线',
      entryPrice: item.entryPrice?.trim() || '等待价格确认',
      addPrice: item.addPrice?.trim() || undefined,
      stopLoss: item.stopLoss?.trim() || undefined,
      exitPrice: item.exitPrice?.trim() || '等待退出条件确认',
      positionSize: item.positionSize?.trim() || undefined,
      reason: item.reason?.trim() || '等待补充理由',
      riskTip: item.riskTip?.trim() || '留意盘面分歧和消息兑现风险',
      t0Strategy: item.t0Strategy?.trim() || undefined,
      timeWindow: item.timeWindow?.trim() || undefined,
    }))

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

export async function runMarketDigestAgent(options: {
  title: string
  market: string
  currentTime: string
  watchlistCodes: string[]
  searchProviders: SearchProvider[]
  provider: AiProvider | null
  maxSteps?: number
  onProgress?: (step: DiagnosisAgentStep) => void
  abortSignal?: AbortSignal
}): Promise<AiInsightDigest> {
  if (!options.provider) {
    throw new Error('当前未配置 AI 模型，无法生成首页市场点评。')
  }

  const { get, post } = useSidecar()
  const strategyStore = useStrategyStore()
  const marketSession = getMarketSessionContext(options.market)
  const state: MarketDigestState = {
    overview: null,
    fundflow: null,
    sectors: null,
    hotStocks: null,
    news: [],
    watchlistQuotes: [],
    klineData: {},
    stockInfo: {},
    fundFlowRank: [],
    advanceDecline: null,
    policySearch: [],
    globalSearch: [],
  }

  const context: MarketDigestContext = {
    title: options.title,
    market: options.market,
    currentTime: options.currentTime,
    marketSession,
    watchlistCodes: options.watchlistCodes,
    state,
    searchProviders: options.searchProviders,
  }

  async function searchNews(query: string, limit = 10) {
    const payload = await post<{ data: Array<Record<string, any>> }>('/api/news/search', {
      query,
      limit,
      providers: normalizeSearchProviders(options.searchProviders || []),
    })
    return payload.data || []
  }

  const tools: ReActTool<MarketDigestContext>[] = [
    {
      name: 'load_market_overview',
      description: '读取市场总览，包括主要指数（上证/深证/创业板）、涨跌家数、成交额、涨幅跌幅排行（movers）和热力图。这是了解当前大盘状态的基础工具。',
      inputSchema: {},
      execute: async () => {
        throwIfAborted(options.abortSignal)
        const response = await get<{ data: Record<string, any> }>(`/api/home/overview?${buildQuery({ market: options.market })}`)
        const data = response.data || {}
        state.overview = data
        const indices = (data as any).indices || []
        const breadth = (data as any).breadth
        return {
          observation: {
            indices: indices.slice(0, 5).map((idx: any) => ({
              name: idx.name, price: idx.price, changePercent: idx.changePercent, amount: idx.amount,
            })),
            breadth,
            summaryCards: ((data as any).summaryCards || []).slice(0, 4),
            movers: (data as any).movers ? {
              gainers: ((data as any).movers.gainers || []).slice(0, 5).map((s: any) => ({ code: s.code, name: s.name, price: s.price, changePercent: s.changePercent })),
              losers: ((data as any).movers.losers || []).slice(0, 5).map((s: any) => ({ code: s.code, name: s.name, price: s.price, changePercent: s.changePercent })),
            } : null,
          },
          summary: `已读取市场总览：${indices.length}个指数，涨跌家数${breadth ? `涨${breadth.advance}/跌${breadth.decline}` : '未知'}`,
          resultCount: indices.length,
        } satisfies ReActToolResult
      },
    },
    {
      name: 'load_fundflow',
      description: '读取资金流向数据，包括板块资金流（行业/概念板块净流入排名）和个股资金流（主力净流入排名）。用于判断主力资金方向。',
      inputSchema: {},
      execute: async () => {
        throwIfAborted(options.abortSignal)
        const response = await get<{ data: Record<string, any> }>(`/api/home/fundflow?${buildQuery({ market: options.market })}`)
        const data = response.data || {}
        state.fundflow = data
        const boardFlows = (data as any).boardFlows || {}
        const industryFlows = boardFlows.industry || []
        const conceptFlows = boardFlows.concept || []
        const stockFlows = (data as any).stockFlows || {}
        const inflow = stockFlows.inflow || []
        return {
          observation: {
            sectorFlows: [
              ...industryFlows.slice(0, 5).map((item: any) => ({ name: item.name, changePercent: item.changePercent, mainNetInflow: Number(item.amount || 0) })),
              ...conceptFlows.slice(0, 5).map((item: any) => ({ name: item.name, changePercent: item.changePercent, mainNetInflow: Number(item.amount || 0) })),
            ],
            stockInflow: inflow.slice(0, 8).map((item: any) => ({
              code: item.code, name: item.name,
              mainNetInflow: 'mainNetInflow' in item ? Number(item.mainNetInflow || 0) : Number(item.amount || 0),
              mainNetInflowPercent: 'mainNetInflowPercent' in item ? Number(item.mainNetInflowPercent || 0) : Number(item.changePercent || 0),
            })),
          },
          summary: `已读取资金流向：行业${industryFlows.length}板块，概念${conceptFlows.length}板块，主力流入${inflow.length}只个股`,
          resultCount: industryFlows.length + conceptFlows.length,
        } satisfies ReActToolResult
      },
    },
    {
      name: 'load_sectors',
      description: '读取板块排行榜（行业和概念板块涨跌排名与领涨股）。用于发现主线方向和板块共振。',
      inputSchema: {},
      execute: async () => {
        throwIfAborted(options.abortSignal)
        const response = await get<{ data: Record<string, any> }>(`/api/home/sectors?${buildQuery({ market: options.market })}`)
        const data = response.data || {}
        state.sectors = data
        const leaders = (data as any).leaders || []
        return {
          observation: leaders.slice(0, 10).map((item: any) => ({
            name: item.name,
            changePercent: item.changePercent,
            amount: item.amount || 0,
            leadingStock: item.leadingStock || '',
          })),
          summary: `已读取板块排行：${leaders.length}个热点方向`,
          resultCount: leaders.length,
        } satisfies ReActToolResult
      },
    },
    {
      name: 'load_hot_stocks',
      description: '读取热门股票榜（活跃股和领涨股），包含实时价格、涨跌幅、成交额和换手率。推荐股票应优先从这些标的中选择。',
      inputSchema: {},
      execute: async () => {
        throwIfAborted(options.abortSignal)
        const response = await get<{ data: Record<string, any> }>(`/api/home/stocks?${buildQuery({ market: options.market })}`)
        const data = response.data || {}
        state.hotStocks = data
        const boards = (data as any).boards || {}
        const active = boards.active || []
        const leaders = boards.leaders || []
        return {
          observation: {
            active: active.slice(0, 12).map((item: any) => ({
              code: item.code, name: item.name, price: item.price,
              changePercent: item.changePercent, amount: item.amount,
              turnover: item.turnover || 0, sectorTags: item.sectorTags || [],
            })),
            leaders: leaders.slice(0, 8).map((item: any) => ({
              code: item.code, name: item.name, price: item.price,
              changePercent: item.changePercent, amount: item.amount,
              turnover: item.turnover || 0,
            })),
          },
          summary: `已读取热门股：活跃${active.length}只，领涨${leaders.length}只`,
          resultCount: active.length + leaders.length,
        } satisfies ReActToolResult
      },
    },
    {
      name: 'load_financial_news',
      description: '读取财经新闻快讯流，用于判断消息面催化与盘面是否一致。',
      inputSchema: { limit: '返回数量，可选，默认 15' },
      execute: async (input) => {
        throwIfAborted(options.abortSignal)
        const limit = Math.max(6, Math.min(Number(input.limit) || 15, 30))
        const response = await get<{ data: Record<string, any> }>(`/api/home/news?${buildQuery({ market: options.market })}`)
        const data = response.data || {}
        const latest = ((data as any).latest || []).slice(0, limit)
        state.news = latest.map((item: any) => ({
          title: item.title,
          source: item.source || '快讯',
          publishTime: item.publishTime || '',
          content: item.content || '',
        }))
        return {
          observation: latest.map((item: any) => ({
            title: item.title, source: item.source || '快讯',
            publishTime: item.publishTime || '', content: item.content || '',
          })),
          summary: `已读取 ${latest.length} 条财经快讯`,
          resultCount: latest.length,
        } satisfies ReActToolResult
      },
    },
    {
      name: 'load_watchlist_quotes',
      description: '读取用户自选股的实时行情报价。用于了解用户关注的个股表现。',
      inputSchema: {},
      execute: async () => {
        throwIfAborted(options.abortSignal)
        const codes = options.watchlistCodes
        if (!codes.length) {
          return {
            observation: [],
            summary: '当前无自选股',
            empty: true,
            resultCount: 0,
          } satisfies ReActToolResult
        }
        const response = await get<{ data: Record<string, any> }>(`/api/market/quotes?${buildQuery({ codes: codes.join(',') })}`)
        const quotes = response.data || []
        const items = (Array.isArray(quotes) ? quotes : []).slice(0, 12)
        state.watchlistQuotes = items.map((q: any) => ({
          code: q.code, name: q.name, price: q.price, changePercent: q.changePercent,
        }))
        return {
          observation: items.map((q: any) => ({
            code: q.code, name: q.name, price: q.price,
            changePercent: q.changePercent, amount: q.amount,
          })),
          summary: `已读取 ${items.length} 只自选股行情`,
          resultCount: items.length,
        } satisfies ReActToolResult
      },
    },
    {
      name: 'load_stock_kline',
      description: '读取个股 K 线数据，支持日/周/月/5分钟/15分钟/30分钟/60分钟周期。用于技术面分析和识别支撑/阻力位。',
      inputSchema: { code: '股票代码（必填）', period: '周期：daily/weekly/monthly/5min/15min/30min/60min，默认 daily', limit: '返回条数，默认 30' },
      execute: async (input) => {
        throwIfAborted(options.abortSignal)
        const code = String(input.code || '').trim()
        if (!code) throw new Error('必须提供股票代码')
        const period = String(input.period || 'daily').trim()
        const limit = Number(input.limit) || 30
        const response = await get<{ data: any[] }>(`/api/kline/${encodeURIComponent(code)}?${buildQuery({ period, limit, adjust: 'qfq' })}`)
        const data = response.data || []
        state.klineData[code] = data
        return {
          observation: data.slice(-Math.min(limit, 60)),
          summary: `已读取 ${code} ${period} K线 ${data.length} 条`,
          empty: !data.length,
          resultCount: data.length,
          retryable: false,
        } satisfies ReActToolResult
      },
    },
    {
      name: 'load_stock_info',
      description: '读取个股基本面信息（公司简介、财务指标），用于判断公司质地和长线逻辑。',
      inputSchema: { code: '股票代码（必填）' },
      execute: async (input) => {
        throwIfAborted(options.abortSignal)
        const code = String(input.code || '').trim()
        if (!code) throw new Error('必须提供股票代码')
        const response = await get<{ info: any; finance: any }>(`/api/market/stock/${encodeURIComponent(code)}/info`)
        const info = response.info || {}
        const finance = response.finance || {}
        state.stockInfo[code] = { info, finance }
        return {
          observation: { code, info, finance },
          summary: `已读取 ${code} 基本信息${info.name ? `：${info.name}` : ''}`,
          empty: !info.name,
          resultCount: info.name ? 1 : 0,
          retryable: false,
        } satisfies ReActToolResult
      },
    },
    {
      name: 'load_fund_flow_rank',
      description: '读取个股资金流向排名（主力净流入/流出排行），用于发现资金异动个股。',
      inputSchema: { limit: '返回数量，默认 15' },
      execute: async (input) => {
        throwIfAborted(options.abortSignal)
        const limit = Number(input.limit) || 15
        const response = await get<{ data: any[] }>(`/api/fundflow/rank?${buildQuery({ limit })}`)
        const data = response.data || []
        state.fundFlowRank = data
        return {
          observation: data.slice(0, limit),
          summary: `已读取资金流排名 ${data.length} 只个股`,
          resultCount: data.length,
        } satisfies ReActToolResult
      },
    },
    {
      name: 'load_advance_decline',
      description: '读取涨跌家数统计（上涨/下跌/平盘家数、总成交额），用于判断市场情绪和广度。',
      inputSchema: {},
      execute: async () => {
        throwIfAborted(options.abortSignal)
        const response = await get<{ data: Record<string, any> }>('/api/market/advance-decline')
        const data = response.data || {}
        state.advanceDecline = data
        return {
          observation: data,
          summary: `涨跌家数：涨${(data as any).advance || '?'} 跌${(data as any).decline || '?'}`,
          resultCount: 1,
        } satisfies ReActToolResult
      },
    },
    {
      name: 'search_policy_updates',
      description: '搜索最新政策面、监管面、产业扶持与行业政策信号。可自定义查询词。',
      inputSchema: { query: '搜索关键词，可选，默认自动构造' },
      execute: async (input) => {
        throwIfAborted(options.abortSignal)
        const marketLabel = describeMarket(options.market)
        const themes = state.sectors
          ? ((state.sectors as any).leaders || []).slice(0, 3).map((item: any) => item.name).join(' ')
          : ''
        const defaultQuery = `${marketLabel} ${marketSession.targetLabel} 政策 产业 扶持 监管 财政 货币 ${themes}`.trim()
        const query = String(input.query || defaultQuery).trim()
        const items = await searchNews(query, 10)
        state.policySearch = items
        return {
          observation: items,
          summary: `已检索 ${items.length} 条政策面结果，查询词：${query}`,
          empty: !items.length,
          resultCount: items.length,
          sourceCount: items.length,
        } satisfies ReActToolResult
      },
    },
    {
      name: 'search_global_updates',
      description: '搜索国际消息、海外宏观、汇率、利率、能源与地缘线索。可自定义查询词。',
      inputSchema: { query: '搜索关键词，可选，默认自动构造' },
      execute: async (input) => {
        throwIfAborted(options.abortSignal)
        const marketLabel = describeMarket(options.market)
        const themes = state.sectors
          ? ((state.sectors as any).leaders || []).slice(0, 3).map((item: any) => item.name).join(' ')
          : ''
        const defaultQuery = `${marketLabel} ${marketSession.targetLabel} 国际消息 美联储 汇率 原油 关税 中东 全球市场 ${themes}`.trim()
        const query = String(input.query || defaultQuery).trim()
        const items = await searchNews(query, 10)
        state.globalSearch = items
        return {
          observation: items,
          summary: `已检索 ${items.length} 条国际消息结果，查询词：${query}`,
          empty: !items.length,
          resultCount: items.length,
          sourceCount: items.length,
        } satisfies ReActToolResult
      },
    },
  ]

  const newsPrompt = strategyStore.getPromptTemplateByCategory('news_analysis')?.content?.trim() || ''
  const dailyPrompt = strategyStore.getPromptTemplateByCategory('daily_eval')?.content?.trim() || ''
  const timingPrompt = buildDigestTimingPrompt(marketSession)
  const timingRules = buildSessionPromptRules(marketSession)
  const defaultSystemPrompt = `你是专业量化交易分析智能体。你必须自主调用工具获取真实数据，基于多源交叉验证生成可执行的交易建议。${timingPrompt}

【核心原则】
- 所有结论必须基于工具返回的真实数据（盘面+资金+新闻+K线+基本面），禁止猜测
- 你必须自己决定调用哪些工具、以什么顺序调用，每轮只能调用一个
- entryPrice / addPrice / stopLoss / exitPrice 必须是精确单值（如"25.30元"），禁止使用区间（如"24-25元"）
- 风险收益比最低 1:1.5，否则不推荐入场
- 短线止损幅度控制在 0.5%-2% 内
- 所有建议必须可立即执行，禁止"关注一下""逢低留意""适当关注"等空话

【推荐工具调用顺序】
1. load_market_overview — 了解大盘指数和涨跌结构
2. load_hot_stocks — 获取活跃股和领涨股，作为推荐候选
3. load_fundflow — 判断主力资金方向
4. load_financial_news — 了解消息面催化
5. load_watchlist_quotes — 了解用户自选股（如有）
6. load_stock_kline — 对重点个股做技术面分析（确认支撑/阻力位）
7. search_policy_updates / search_global_updates — 了解宏观和政策环境
你可以根据实际情况调整调用顺序和次数。如果已有足够证据就提前 finish。

【量化决策框架】
1. 技术面：识别支撑/阻力位（前高前低、整数关口、均线位），判断当前价格在结构中的位置
2. 资金面：结合 fundFlows 判断主力资金方向，大单净流入为加分项
3. 消息面：新闻/政策是否有实质催化，区分已落地vs预期中
4. 量价配合：放量突破有效性强于缩量，放量滞涨需警惕
5. 板块共振：所属板块是否有 2 只以上个股同步异动

【watchStocks 输出规范】
- 固定 6 只：3 短线 + 3 长线，优先从 load_hot_stocks 返回的标的中选择
- entryPrice：精确建仓价，如实时价 25.10，应写"25.30元站稳可建仓"（回踩场景）或"突破25.80元确认可追"（突破场景）
- addPrice：精确加仓价及条件，如"回踩24.80元不破5日线可加仓"
- stopLoss：精确止损价，如"跌破24.50元止损"或"跌破24.30元清仓"
- exitPrice：分批止盈，如"第一目标26.80元减1/3，27.50元再减1/3，破5日线清仓"
- positionSize：具体仓位，如"1/3仓试探，确认后加至半仓"
- t0Strategy：做T建议，如"盘中冲高26元以上先卖1/3，回落25.20元接回"
- timeWindow：执行时间窗，如"10:00前站稳25.30元执行"或"午后开盘观察方向再决定"

【禁止事项】
- 禁止虚构新闻或引用预设结论
- 禁止因为接口返回"热门板块""焦点个股"就直接认定主线成立或推荐追高
- 禁止使用"20-25区间""可适当关注""逢低布局"等模糊表述
- 如果证据矛盾或不足，必须降低 confidenceLabel 并建议等待确认
- 同一工具失败超过 3 次后不能再调用

【字段精简】
- headline 28字以内；summary/newsView/policyView/globalView/shortTermView/longTermView/futureOutlook 各1-2句
- focusThemes 最多3个；bullets/keyRisks 最多各3条
- watchStocks 固定6个（3短+3长），每个字段都必须填写`
  const strategyTpl = strategyStore.getPromptTemplateByCategory('market_digest_agent')?.content?.trim()
  const systemPrompt = strategyTpl
    ? `${strategyTpl}${timingPrompt ? `\n\n${timingPrompt}` : ''}${dailyPrompt ? `\n\n每日评估模板参考：\n${dailyPrompt}` : ''}${newsPrompt ? `\n\n新闻分析模板参考：\n${newsPrompt}` : ''}`
    : `${defaultSystemPrompt}${dailyPrompt ? `\n\n每日评估模板参考：\n${dailyPrompt}` : ''}${newsPrompt ? `\n\n新闻分析模板参考：\n${newsPrompt}` : ''}`

  const reactResult = await runReActLoop<MarketDigestContext, AiInsightDigest>({
    provider: options.provider,
    context,
    tools,
    maxTurns: normalizeAgentMaxSteps(options.maxSteps, { min: 6, fallback: 8 }),
    abortSignal: options.abortSignal,
    onProgress: options.onProgress,
    requireFinalAnswer: true,
    finalAnswerSchema: MARKET_DIGEST_FINAL_SCHEMA,
    planInputSummary: `${options.title} / ${describeMarket(options.market)}`,
    planQuery: options.title,
    systemPrompt,
    userPrompt: JSON.stringify({
      task: options.title,
      marketSession,
      timingRules,
      requirement: [
        '你必须自主调用工具获取数据，不要假设已有任何预加载数据',
        '至少调用 load_market_overview、load_hot_stocks、load_fundflow、load_financial_news 各一次',
        '推荐股票必须基于工具返回的真实报价数据，不要虚构价格',
        '所有价格建议必须是精确单值，禁止区间表达',
        '如果数据不足以支持某只股票的推荐，降低 confidenceLabel 或不推荐该股票',
      ],
    }, null, 2),
    nextStepPrompt: '请判断当前证据是否足以给出精确价位、仓位、做T策略和时间窗口。建议至少调用：load_market_overview（大盘状态）→ load_hot_stocks（候选标的）→ load_fundflow（资金方向）→ load_financial_news（消息面）。对重点个股可用 load_stock_kline 确认技术位。所有推荐股票的价格必须来自工具返回的真实数据。每只股票的 entryPrice/addPrice/stopLoss/exitPrice 必须是精确单值（禁止区间）。如果证据不足就继续调用工具，如果已充分则 finish 返回最终 JSON。同一工具失败超过 3 次后不能再调用。',
    toolMaxTokens: 4000,
    toolTimeoutMs: 300000,
  })

  if (!reactResult.finalAnswer) {
    throw new Error('首页市场点评智能体未返回最终结果')
  }

  return sanitizeDigest(reactResult.finalAnswer)
}
