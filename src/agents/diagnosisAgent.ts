import { useAiChat, isAuthError } from '@/composables/useAiChat'
import { useSidecar } from '@/composables/useSidecar'
import { runReActLoop, type ReActTool, type ReActToolResult } from '@/agents/core/reactAgent'
import type { AiDiagnosis, AiProvider, DiagnosisAgentStep, DiagnosisEvidence, KlineData, SearchProvider, Strategy, TechnicalSnapshot } from '@/types'
import { buildDiagnosisTimingPrompt, getMarketSessionContext, type MarketSessionContext } from '@/utils/marketSession'
import { buildTechnicalSnapshot, getStockProfile } from '@/utils/marketMetrics'
import { normalizeSecurityCode } from '@/utils/security'

interface BidAsk {
  price: number
  volume: number
}

export interface DiagnosisStockInfo {
  code: string
  name: string
  price: number
  open: number
  high: number
  low: number
  preClose: number
  change: number
  changePercent: number
  volume: number
  amount: number
  turnover: number
  date: string
  time: string
  bids: BidAsk[]
  asks: BidAsk[]
}

export interface DiagnosisFinanceInfo {
  pe: number
  pb: number
  totalMv: number
  circMv: number
  roe: number
  eps: number
  bps: number
  turnover: number
}

export interface DiagnosisNewsItem {
  id?: string
  title: string
  url: string
  source: string
  publishTime: string
  summary?: string
  content?: string
}

interface SearchResultItem {
  title: string
  content: string
  link: string
  media?: string
  providerId?: string
  providerName?: string
}

interface AgentPlanStep {
  tool:
    | 'search_stock'
    | 'load_quote'
    | 'load_kline'
    | 'load_stock_news'
    | 'load_macro_news'
    | 'load_financial_news'
    | 'load_fund_flow'
    | 'load_sector_rank'
    | 'load_concept_rank'
    | 'load_market_indices'
    | 'load_advance_decline'
    | 'load_finance_report'
    | 'web_search'
  reason: string
  query?: string
  providers?: string[]
}

interface StrategyContext {
  id: string
  name: string
  description: string
  notes?: string
  category: Strategy['category']
}

interface AgentToolDescriptor {
  tool: AgentPlanStep['tool']
  module: string
  description: string
}

interface MarketBreadthSnapshot {
  advance: number
  decline: number
  flat: number
  total: number
  totalAmount: number
}

export interface DiagnosisAgentResult {
  stockInfo: DiagnosisStockInfo
  finance: DiagnosisFinanceInfo
  klineData: KlineData[]
  stockNews: DiagnosisNewsItem[]
  macroNews: DiagnosisNewsItem[]
  financeReport: any
  technical: TechnicalSnapshot
  diagnosis: AiDiagnosis
  trace: DiagnosisAgentStep[]
  policyEvidence: DiagnosisEvidence[]
  selectedStrategy: StrategyContext | null
  llmSummary: {
    used: boolean
    notice: string
  }
}

export interface DiagnosisAgentProgressEvent {
  step: DiagnosisAgentStep
}

export interface DiagnosisAgentPartialResult {
  stockInfo: DiagnosisStockInfo | null
  finance: DiagnosisFinanceInfo
  klineData: KlineData[]
  stockNews: DiagnosisNewsItem[]
  macroNews: DiagnosisNewsItem[]
  financeReport: any
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function createStep(partial: Omit<DiagnosisAgentStep, 'id' | 'startedAt' | 'finishedAt'>): DiagnosisAgentStep {
  const now = Date.now()
  return {
    id: `${partial.kind}_${now}_${Math.random().toString(36).slice(2, 8)}`,
    startedAt: now,
    finishedAt: now,
    durationMs: 0,
    ...partial,
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} 超时（${Math.round(ms / 1000)}s）`))
    }, ms)

    promise
      .then((value) => {
        clearTimeout(timer)
        resolve(value)
      })
      .catch((error) => {
        clearTimeout(timer)
        reject(error)
      })
  })
}

function parseJsonBlock<T>(raw: string): T {
  const matched = raw.match(/```json\s*([\s\S]*?)\s*```/) || raw.match(/\{[\s\S]*\}/)
  if (!matched) throw new Error('模型未返回 JSON')
  return JSON.parse(matched[1] || matched[0]) as T
}

function createStrategyContext(strategy?: Strategy | null): StrategyContext | null {
  if (!strategy) return null
  return {
    id: strategy.id,
    name: strategy.name,
    description: strategy.description,
    notes: strategy.notes,
    category: strategy.category,
  }
}

function describeToolFocus(tool: AgentPlanStep['tool'], strategy?: Strategy | null) {
  switch (tool) {
    case 'load_quote':
      return '实时价格、五档盘口、估值、涨跌停位置'
    case 'load_market_indices':
      return '上证、深证、创业板等指数强弱与市场风格'
    case 'load_advance_decline':
      return '全市场涨跌家数、赚钱效应、总量能'
    case 'load_kline':
      return 'K线结构、均线、MACD、RSI、成交量、支撑压力'
    case 'load_stock_news':
      return '公司公告、产品进展、订单、回购、经营动态'
    case 'load_macro_news':
      return '与个股直接相关的政策、宏观、行业消息'
    case 'load_financial_news':
      return '最新财经要闻、国际事件、政策变化'
    case 'load_fund_flow':
      return '个股近期主力净流入趋势、超大单大单散户资金'
    case 'load_sector_rank':
      return '所属行业热度、板块强弱、龙头股表现'
    case 'load_concept_rank':
      return '相关概念题材热度、情绪扩散、活跃龙头'
    case 'load_finance_report':
      return '近4期三大财报（资产负债表、利润表、现金流量表）核心指标与趋势'
    case 'web_search':
      return strategy ? `${strategy.name} 相关外部舆情、政策和市场讨论` : '外部舆情、政策导向、公司战略与市场讨论'
  }
}

function createAbortError() {
  const error = new Error('AI 任务已停止')
  error.name = 'AbortError'
  return error
}

function withAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise
  if (signal.aborted) {
    return Promise.reject(createAbortError())
  }

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(createAbortError())
    signal.addEventListener('abort', onAbort, { once: true })
    promise
      .then((value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      })
      .catch((error) => {
        signal.removeEventListener('abort', onAbort)
        reject(error)
      })
  })
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw createAbortError()
  }
}

function escapeRegExp(input: string) {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function resolveMarketQueryParam(code: string) {
  const profile = getStockProfile(code)
  if (profile.market === 'hk') return 'hk'
  if (profile.market === 'us') return 'us'
  return 'a'
}

function describeMarketScope(market: string) {
  if (market === 'hk') return '港股'
  if (market === 'us') return '美股'
  return 'A股'
}

function buildQuestionFocus(question?: string, stockName?: string, matchedKeyword?: string) {
  let raw = `${question || ''}`
  if (stockName) {
    raw = raw.replace(new RegExp(escapeRegExp(stockName), 'g'), '')
  }
  if (matchedKeyword) {
    raw = raw.replace(new RegExp(escapeRegExp(matchedKeyword), 'g'), '')
  }
  raw = raw
    .replace(/[？?。！，,、；;：:\s（）()【】《》"'`]/g, '')
    .replace(/(请问|帮我|请帮我|麻烦|看看|分析一下|分析|诊断一下|诊断|研究一下|研究|评估一下|评估|股票|个股|走势|行情|情况|怎么样|怎么看|如何|能买吗|买入吗|卖出吗|买入|卖出|可以吗|吗|呢|呀|吧)+/g, '')
    .trim()

  return raw.slice(0, 18)
}

function buildToolCatalog(searchProviders: SearchProvider[]): AgentToolDescriptor[] {
  const tools: AgentToolDescriptor[] = [
    { tool: 'search_stock', module: 'stock.search', description: '根据用户问题中的股票名称或代码搜索匹配的股票，返回代码和名称。仅在后续工具必须依赖股票代码时再使用。' },
    { tool: 'load_quote', module: 'stock.quote', description: '读取实时价格、涨跌、估值、五档盘口和涨跌停位置。' },
    { tool: 'load_market_indices', module: 'market.indices', description: '读取上证、深证、创业板等大盘指数与市场风格。' },
    { tool: 'load_advance_decline', module: 'market.advance_decline', description: '读取涨跌家数、总量能，判断市场整体情绪和赚钱效应。' },
    { tool: 'load_kline', module: 'stock.kline', description: '读取日线或其他周期 K 线、均线、MACD、RSI、量能和支撑压力。' },
    { tool: 'load_stock_news', module: 'news.stock', description: '按股票名称、代码或关键词读取个股公告、公司新闻、订单、回购和经营动态。' },
    { tool: 'load_macro_news', module: 'news.context', description: '按股票名称、代码或关键词读取与个股相关的宏观新闻、政策导向、行业景气度。' },
    { tool: 'load_financial_news', module: 'news.financial', description: '读取最新财经要闻、国际消息、政策变化、社会舆情和地缘政治动态。' },
    { tool: 'load_fund_flow', module: 'capital.flow', description: '读取个股近期主力净流入、超大单、大单、散户资金趋势。' },
    { tool: 'load_sector_rank', module: 'sector.industry', description: '读取行业热度、行业涨跌幅和龙头表现。' },
    { tool: 'load_concept_rank', module: 'sector.concept', description: '读取概念题材热度、情绪扩散和活跃龙头。' },
    { tool: 'load_finance_report', module: 'stock.finance', description: '读取近4期资产负债表、利润表、现金流量表，分析营收增速、利润率、现金流健康度、负债率等基本面趋势。' },
  ]

  tools.push({
    tool: 'web_search',
    module: 'search.web',
    description: searchProviders.length
      ? `补充外部舆情、政策消息、行业讨论和国际热点。可用搜索源：${searchProviders.map((item) => item.name).join('、')}`
      : '补充外部舆情、政策消息、行业讨论和国际热点。未配置外部搜索源时使用当前默认搜索实现。',
  })

  return tools
}

function pickSearchQuery(strategy?: Strategy | null, questionFocus?: string) {
  const focus = questionFocus ? ` ${questionFocus}` : ''
  if (!strategy) return `政策变化 国际贸易 社会舆情 行业动态 公司最新消息${focus}`
  if (strategy.category === 'fundamental') return `${strategy.name} 政策导向 公司战略 行业景气度 机构观点 国际影响${focus}`
  if (strategy.category === 'volume') return `${strategy.name} 成交量变化 放量原因 主力行为 资金面政策${focus}`
  if (strategy.category === 'pattern' || strategy.category === 'trend') return `${strategy.name} 龙头板块 市场风格 情绪变化 政策催化 国际事件${focus}`
  if (strategy.category === 'momentum') return `${strategy.name} 强弱切换 相对强度 资金偏好 社会舆情${focus}`
  return `${strategy.name} 政策变化 国际事件 社会舆情 行业动态${focus}`
}

function buildStrategyFocus(strategy: Strategy | null | undefined, technical: TechnicalSnapshot, evidence: DiagnosisEvidence[]) {
  const defaultFocus = technical.trend === 'bullish'
    ? ['趋势延续', '量价确认', '支撑防守']
    : ['技术面优先', '消息面交叉验证', '仓位先行控制']
  if (!strategy) return defaultFocus
  return [
    strategy.name,
    strategy.notes?.split('。').find(Boolean) || strategy.description,
    evidence[0]?.source ? `${evidence[0].source}交叉验证` : '实时数据交叉验证',
  ].slice(0, 3)
}

function buildToolInputSummary(step: AgentPlanStep, stockInfo: DiagnosisStockInfo, strategy: Strategy | null | undefined, period: string, adjust: string) {
  const strategyName = strategy?.name || '默认综合框架'
  switch (step.tool) {
    case 'search_stock':
      return '根据用户问题搜索匹配的股票，获取准确的股票代码和名称。'
    case 'load_quote':
      return `读取 ${stockInfo.name} 的实时价格、盘口五档、估值和涨跌停位置；评估方式采用 ${strategyName}。`
    case 'load_market_indices':
      return '读取上证、深证、创业板等市场指数，确认当前大盘风险偏好和风格。'
    case 'load_advance_decline':
      return '读取全市场涨跌家数和总量能，判断市场整体赚钱效应。'
    case 'load_kline':
      return `读取 ${period} / ${adjust} K 线，关注均线、MACD、RSI、成交量和关键支撑压力。`
    case 'load_stock_news':
      return `读取 ${stockInfo.name} 近端公司新闻、公告、回购、订单和经营动态。`
    case 'load_macro_news':
      return `读取与 ${stockInfo.name} 直接相关的政策、国际、行业和市场环境消息。`
    case 'load_financial_news':
      return '读取最新财经要闻、国际事件和政策变化。'
    case 'load_fund_flow':
      return `读取 ${stockInfo.name} 近期个股资金流（主力、超大单、大单、散户），确认资金趋势。`
    case 'load_sector_rank':
      return `读取 ${stockInfo.name} 所属行业与行业热度榜，确认主线行业强弱。`
    case 'load_concept_rank':
      return `读取 ${stockInfo.name} 相关概念题材与题材热度榜，确认情绪是否扩散。`
    case 'load_finance_report':
      return `读取 ${stockInfo.name} 近4期资产负债表、利润表和现金流量表，评估基本面趋势。`
    case 'web_search':
      return `检索方向：${step.query || pickSearchQuery(strategy)}。${step.providers?.length ? ` 搜索源：${step.providers.join('、')}。` : ''}`
  }
}

function buildToolResultSummary(
  step: AgentPlanStep,
  stockInfo: DiagnosisStockInfo,
  finance: DiagnosisFinanceInfo,
  klineData: KlineData[],
  stockNews: DiagnosisNewsItem[],
  macroNews: DiagnosisNewsItem[],
  financialNews: DiagnosisNewsItem[],
  fundFlow: any,
  sectorRank: any[],
  conceptRank: any[],
  marketIndices: Array<{ code: string; name: string; price: number; changePercent: number }>,
  advanceDecline: { advance: number; decline: number; flat: number; total: number; totalAmount: number } | null,
  searchEvidence: SearchResultItem[],
  financeReport: any,
) {
  switch (step.tool) {
    case 'load_quote':
      return `${stockInfo.name} ${stockInfo.price.toFixed(2)}，涨跌 ${stockInfo.changePercent.toFixed(2)}%，换手 ${stockInfo.turnover.toFixed(2)}%，PE ${finance.pe || '--'}，PB ${finance.pb || '--'}`
    case 'load_market_indices':
      return `读取 ${marketIndices.length} 个市场指数，前排：${marketIndices.slice(0, 3).map((item) => item.name).join('、') || '暂无'}`
    case 'load_advance_decline':
      return advanceDecline ? `涨 ${advanceDecline.advance} / 跌 ${advanceDecline.decline} / 平 ${advanceDecline.flat}，总量能 ${(advanceDecline.totalAmount / 1e9).toFixed(0)} 亿` : '涨跌家数暂无'
    case 'load_kline':
      return `读取 ${klineData.length} 根 K 线，最近收盘 ${klineData[klineData.length - 1]?.close?.toFixed(2) || '--'}`
    case 'load_stock_news':
      return `读取 ${stockNews.length} 条个股新闻，最新：${stockNews[0]?.title || '暂无'}`
    case 'load_macro_news':
      return `读取 ${macroNews.length} 条相关政策/国际消息，最新：${macroNews[0]?.title || '暂无'}`
    case 'load_financial_news':
      return `读取 ${financialNews.length} 条财经要闻，最新：${financialNews[0]?.title || '暂无'}`
    case 'load_fund_flow':
      if (fundFlow?.recentFlows?.length) {
        const latest = fundFlow.recentFlows[fundFlow.recentFlows.length - 1]
        const total3 = fundFlow.recentFlows.slice(-3).reduce((s: number, d: any) => s + (d.mainNetInflow || 0), 0)
        return `${stockInfo.name} 近${fundFlow.recentFlows.length}日资金流，最新(${latest.date})主力净流入 ${latest.mainNetInflow?.toFixed(0)}，近3日合计 ${total3.toFixed(0)}`
      }
      return fundFlow?.name ? `匹配到资金流记录 ${fundFlow.name}，主力净流入 ${fundFlow.mainNetInflow}` : '未匹配到资金流数据'
    case 'load_sector_rank':
      return `读取 ${sectorRank.length} 个行业板块，前排：${sectorRank.slice(0, 3).map((item) => item.name).join('、') || '暂无'}`
    case 'load_concept_rank':
      return `读取 ${conceptRank.length} 个概念板块，前排：${conceptRank.slice(0, 3).map((item) => item.name).join('、') || '暂无'}`
    case 'web_search':
      return `读取 ${searchEvidence.length} 条外部搜索结果，最新：${searchEvidence[0]?.title || '暂无'}`
    case 'load_finance_report':
      if (financeReport?.incomeStatement?.length) {
        const latest = financeReport.incomeStatement[0]
        const prev = financeReport.incomeStatement[1]
        const revenueGrowth = prev?.totalRevenue ? (((latest.totalRevenue - prev.totalRevenue) / prev.totalRevenue) * 100).toFixed(1) : '--'
        return `近${financeReport.incomeStatement.length}期财报：最新营收 ${(latest.totalRevenue / 1e8).toFixed(2)}亿，同比增速 ${revenueGrowth}%，净利润 ${(latest.netProfit / 1e8).toFixed(2)}亿`
      }
      return '财报数据暂无'
  }
}

function dedupeStrings(items: Array<string | undefined | null>, limit = 6) {
  const seen = new Set<string>()
  const result: string[] = []
  for (const item of items) {
    const normalized = `${item || ''}`.replace(/\s+/g, ' ').trim()
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    result.push(normalized)
    if (result.length >= limit) break
  }
  return result
}

function clipText(text?: string, limit = 56) {
  const normalized = `${text || ''}`.replace(/\s+/g, ' ').trim()
  if (!normalized) return ''
  return normalized.length > limit ? `${normalized.slice(0, limit - 1)}…` : normalized
}

function isNegativeSignal(text?: string) {
  return /(下滑|承压|风险|拖累|制裁|冲突|波动|收紧|下跌|减持|亏损|回落|压力|疲弱|走弱|扰动)/.test(`${text || ''}`)
}

function buildPhaseActionLabel(session: MarketSessionContext) {
  switch (session.phase) {
    case 'pre_market':
      return '盘前重点看开盘后的首轮量价确认'
    case 'trading':
      return '盘中重点看当前到尾盘的承接、回落与再拉升强弱'
    case 'midday_break':
      return '午间重点看午后开盘后的承接和板块扩散'
    case 'post_market':
      return '盘后重点看收盘结构与次日竞价强弱'
    case 'holiday_closed':
      return '休市阶段重点看下一次开盘后的承接与主线方向'
  }
}

function buildSessionSummary(
  session: MarketSessionContext,
  prediction: string,
  support: number,
  resistance: number,
) {
  const phaseActionLabel = buildPhaseActionLabel(session)
  if (prediction === '看多') {
    return `技术面维持偏强结构，预计短线仍有上行动能。${phaseActionLabel}，优先围绕 ${support.toFixed(2)} 一线承接做跟踪，只有量能继续放大并突破 ${resistance.toFixed(2)} 才考虑加仓。`
  }
  if (prediction === '看空') {
    return `当前技术结构偏弱，预计短线仍以回落或弱反弹为主。${phaseActionLabel}，只要不能重新站稳 ${resistance.toFixed(2)}，操作上就以防守、减仓和等待新支撑确认为主。`
  }
  return `当前结构以震荡为主，暂未形成高把握度单边趋势。${phaseActionLabel}，先看 ${support.toFixed(2)} 至 ${resistance.toFixed(2)} 区间内的量价选择，再决定是否参与。`
}

function sanitizeDiagnosis(
  diagnosis: AiDiagnosis,
  trace: DiagnosisAgentStep[],
  evidence: DiagnosisEvidence[],
) {
  const normalizeStringArray = (value: unknown, limit = 5) => {
    if (Array.isArray(value)) {
      return value.map((item) => `${item || ''}`.trim()).filter(Boolean).slice(0, limit)
    }
    if (typeof value === 'string' && value.trim()) {
      return value.split(/[；;\n]/).map((item) => item.trim()).filter(Boolean).slice(0, limit)
    }
    return []
  }
  return {
    ...diagnosis,
    confidence: Number(diagnosis.confidence) || 0,
    catalysts: normalizeStringArray(diagnosis.catalysts),
    risks: normalizeStringArray(diagnosis.risks),
    socialSignals: normalizeStringArray(diagnosis.socialSignals),
    scenarios: diagnosis.scenarios?.length ? diagnosis.scenarios.slice(0, 5) : diagnosis.scenarios,
    strategyFocus: normalizeStringArray(diagnosis.strategyFocus),
    evidence: diagnosis.evidence?.length ? diagnosis.evidence.slice(0, 8) : evidence.slice(0, 8),
    toolCalls: trace,
    generatedAt: Date.now(),
  }
}

function getSearchProviderLabel(provider: SearchProvider) {
  return provider.name || provider.id
}

function normalizeSearchProviders(searchProviders?: SearchProvider[] | null, activeSearchProvider?: SearchProvider | null) {
  const seen = new Set<string>()
  const providers = [...(searchProviders || [])]
    .filter((provider) => provider.enabled && provider.apiUrl.trim() && (provider.provider !== 'zhipu' || provider.apiKey.trim()))
    .sort((a, b) => {
      if (activeSearchProvider?.id === a.id) return -1
      if (activeSearchProvider?.id === b.id) return 1
      return 0
    })
    .filter((provider) => {
      if (seen.has(provider.id)) return false
      seen.add(provider.id)
      return true
    })
  return providers
}

async function runWebSearch(
  post: ReturnType<typeof useSidecar>['post'],
  searchProviders: SearchProvider[],
  query: string,
) {
  const payload = await post<{ data: SearchResultItem[] }>('/api/news/search', {
    query,
    limit: 20,
    providers: searchProviders.map((provider) => ({
      id: provider.id,
      name: provider.name,
      provider: provider.provider,
      apiUrl: provider.apiUrl,
      apiKey: provider.apiKey,
      enabled: provider.enabled,
      proxyId: provider.proxyId || '',
    })),
  })
  return payload.data || []
}

export async function runDiagnosisAgent(options: {
  code?: string
  question?: string
  provider: AiProvider | null
  searchProviders?: SearchProvider[] | null
  activeSearchProvider?: SearchProvider | null
  maxSteps?: number
  period?: string
  adjust?: string
  selectedStrategy?: Strategy | null
  resolvedName?: string
  matchedKeyword?: string
  matchCandidates?: Array<{ code: string; name: string }>
  conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>
  onProgress?: (event: DiagnosisAgentProgressEvent) => void
  onPartial?: (result: DiagnosisAgentPartialResult) => void
  onStreamDelta?: (text: string) => void
  abortSignal?: AbortSignal
}): Promise<DiagnosisAgentResult> {
  const { get, post } = useSidecar()
  const trace: DiagnosisAgentStep[] = []
  const selectedStrategy = options.selectedStrategy || null
  const selectedStrategyContext = createStrategyContext(selectedStrategy)
  const availableSearchProviders = normalizeSearchProviders(options.searchProviders, options.activeSearchProvider)
  const toolCatalog = buildToolCatalog(availableSearchProviders)
  const emitProgress = (step: DiagnosisAgentStep) => {
    options.onProgress?.({ step })
  }
  const emitPartial = () => {
    options.onPartial?.({
      stockInfo: stockInfo.code ? { ...stockInfo } : null,
      finance: { ...finance },
      klineData: [...klineData],
      stockNews: [...stockNews],
      macroNews: [...macroNews],
      financeReport,
    })
  }

  const period = options.period || 'daily'
  const adjust = options.adjust || 'qfq'
  const maxSteps = Math.max(3, Math.min(options.maxSteps || 12, 5))
  const planningTimeoutMs = 240000
  let normalizedCode = options.code ? normalizeSecurityCode(options.code) : ''

  let stockInfo: DiagnosisStockInfo = { code: '', name: '', price: 0, open: 0, high: 0, low: 0, preClose: 0, change: 0, changePercent: 0, volume: 0, amount: 0, turnover: 0, date: '', time: '', bids: [], asks: [] }
  let finance: DiagnosisFinanceInfo = { pe: 0, pb: 0, totalMv: 0, circMv: 0, roe: 0, eps: 0, bps: 0, turnover: 0 }
  let profile = getStockProfile('')
  let marketQuery = resolveMarketQueryParam('')
  let marketSession = getMarketSessionContext('a')
  let diagnosisTimingPrompt = ''
  let questionFocus = ''
  let financeReport: any = null
  let klineData: KlineData[] = []
  let stockNews: DiagnosisNewsItem[] = []
  let macroNews: DiagnosisNewsItem[] = []
  let financialNews: DiagnosisNewsItem[] = []
  let fundFlow: any = null
  let sectorRank: any[] = []
  let conceptRank: any[] = []
  let marketIndices: Array<{ code: string; name: string; price: number; changePercent: number }> = []
  let advanceDecline: MarketBreadthSnapshot | null = null
  let searchEvidence: SearchResultItem[] = []

  function buildLookupKeyword() {
    return `${options.resolvedName || options.matchedKeyword || questionFocus || options.question || normalizedCode || ''}`.trim()
  }

  function buildNewsLookupCode() {
    return normalizeSecurityCode(normalizedCode || stockInfo.code || '') || buildLookupKeyword() || 'unknown'
  }

  function buildDisplayName() {
    return stockInfo.name || options.resolvedName || options.matchedKeyword || buildLookupKeyword() || normalizedCode || '未命名标的'
  }

  function syncDerivedState() {
    const code = stockInfo.code || normalizedCode
    if (!code) return
    profile = getStockProfile(code)
    marketQuery = resolveMarketQueryParam(code)
    marketSession = getMarketSessionContext(profile.market)
    diagnosisTimingPrompt = buildDiagnosisTimingPrompt(marketSession, stockInfo.name || options.resolvedName || code)
    questionFocus = buildQuestionFocus(options.question, stockInfo.name || options.resolvedName, options.matchedKeyword)
  }

  async function resolveCodeIfNeeded(targetKeyword?: string) {
    throwIfAborted(options.abortSignal)
    if (normalizedCode) return normalizedCode
    const keyword = `${targetKeyword || buildLookupKeyword()}`.trim()
    if (!keyword) {
      throw new Error('缺少股票代码或名称，无法定位个股')
    }
    const searchResp = await withAbort(
      get<{ data: Array<{ code: string; name: string }> }>(`/api/market/search?keyword=${encodeURIComponent(keyword)}&limit=5&lite=1`),
      options.abortSignal,
    )
    const candidates = searchResp.data || []
    if (!candidates.length) {
      throw new Error(`未找到与「${keyword}」匹配的股票`)
    }
    normalizedCode = normalizeSecurityCode(candidates[0].code)
    options.resolvedName = candidates[0].name
    return normalizedCode
  }

  async function ensureQuoteLoaded(targetCode?: string) {
    throwIfAborted(options.abortSignal)
    const code = normalizeSecurityCode(targetCode || normalizedCode)
    if (!code) {
      throw new Error('缺少股票代码，无法加载实时行情')
    }
    const quoteRes = await withAbort(
      get<{ info: DiagnosisStockInfo; finance: DiagnosisFinanceInfo }>(`/api/market/stock/${code}/info`),
      options.abortSignal,
    )
    stockInfo = { ...quoteRes.info, code: normalizeSecurityCode(quoteRes.info.code || code) }
    finance = quoteRes.finance
    normalizedCode = stockInfo.code
    syncDerivedState()
    emitPartial()
  }

  function compactNews(items: DiagnosisNewsItem[], limit = 6) {
    return items.slice(0, limit).map((item) => ({
      title: item.title,
      source: item.source,
      publishTime: item.publishTime,
      summary: clipText(item.summary || item.content || item.title, 120),
    }))
  }

  function compactKline() {
    const recent = klineData.slice(-10)
    return {
      total: klineData.length,
      recent: recent.map((item) => ({
        date: item.timestamp ? new Date(item.timestamp).toISOString().slice(0, 10) : '',
        open: item.open,
        high: item.high,
        low: item.low,
        close: item.close,
        volume: item.volume,
      })),
      technical: buildTechnicalSnapshot(klineData),
    }
  }

  function compactFinanceReportData() {
    if (!financeReport) return null
    return {
      incomeStatement: financeReport.incomeStatement?.slice(0, 4).map((item: any) => ({
        reportDate: item.reportDate,
        totalRevenue: item.totalRevenue,
        netProfit: item.netProfit,
        eps: item.eps,
      })),
      balanceSheet: financeReport.balanceSheet?.slice(0, 4).map((item: any) => ({
        reportDate: item.reportDate,
        totalAssets: item.totalAssets,
        totalLiabilities: item.totalLiabilities,
        cash: item.cash,
      })),
      cashflowStatement: financeReport.cashflowStatement?.slice(0, 4).map((item: any) => ({
        reportDate: item.reportDate,
        operatingCashFlow: item.operatingCashFlow,
        capex: item.capex,
      })),
    }
  }

  function compactFundFlowData() {
    if (!fundFlow) return null
    return {
      code: fundFlow.code || normalizedCode,
      mainNetInflow: fundFlow.mainNetInflow,
      mainNetInflowPercent: fundFlow.mainNetInflowPercent,
      recentFlows: (fundFlow.recentFlows || []).slice(-3).map((item: any) => ({
        date: item.date,
        mainNetInflow: item.mainNetInflow,
        mainNetInflowPercent: item.mainNetInflowPercent,
      })),
    }
  }

  function compactMarketIndicesData() {
    return marketIndices.slice(0, 3).map((item) => ({
      code: item.code,
      name: item.name,
      price: item.price,
      changePercent: item.changePercent,
    }))
  }

  function compactSectorRankData(items: any[], limit = 4) {
    return items.slice(0, limit).map((item) => ({
      name: item.name,
      changePercent: item.changePercent,
      leadingStock: item.leadingStock || '',
    }))
  }

  function compactSearchEvidenceData(limit = 4) {
    return searchEvidence.slice(0, limit).map((item) => ({
      title: item.title,
      content: clipText(item.content, 120),
      source: item.providerName || item.media || '',
      link: item.link,
    }))
  }

  function buildSynthesisPayload() {
    return {
      question: options.question || '',
      stock: {
        code: stockInfo.code,
        name: stockInfo.name,
        price: stockInfo.price,
        changePercent: stockInfo.changePercent,
        turnover: stockInfo.turnover,
      },
      finance: {
        pe: finance.pe,
        pb: finance.pb,
        roe: finance.roe,
        totalMv: finance.totalMv,
      },
      technical,
      marketSession: {
        market: marketSession.market,
        phase: marketSession.phase,
        currentTime: `${marketSession.currentDate} ${marketSession.currentTime}`,
      },
      fundFlow: compactFundFlowData(),
      marketIndices: compactMarketIndicesData().slice(0, 2),
      advanceDecline,
      sectorRank: compactSectorRankData(sectorRank, 2),
      conceptRank: compactSectorRankData(conceptRank, 2),
      stockNews: compactNews(stockNews, 2),
      macroNews: compactNews(macroNews, 2),
      financialNews: compactNews(financialNews, 2),
      financeReport: compactFinanceReportData()
        ? {
            incomeStatement: compactFinanceReportData()?.incomeStatement?.slice(0, 2),
            balanceSheet: compactFinanceReportData()?.balanceSheet?.slice(0, 1),
          }
        : null,
      searchEvidence: compactSearchEvidenceData(2),
      recentKline: compactKline(),
      trace: trace
        .filter((item) => item.kind === 'tool')
        .slice(-6)
        .map((item) => ({
          tool: item.tool || item.title,
          summary: item.resultSummary,
        })),
    }
  }

  async function runDiagnosisTool(
    step: Pick<AgentPlanStep, 'tool' | 'query' | 'providers'>,
  ): Promise<ReActToolResult> {
    throwIfAborted(options.abortSignal)
    if (step.tool === 'search_stock') {
      const keyword = `${step.query || buildLookupKeyword()}`.trim()
      if (!keyword) {
        return {
          observation: { skipped: true },
          summary: '没有可用于检索的关键词',
        }
      }
      const searchResp = await withAbort(
        get<{ data: Array<{ code: string; name: string }> }>(`/api/market/search?keyword=${encodeURIComponent(keyword)}&limit=5&lite=1`),
        options.abortSignal,
      )
      const candidates = searchResp.data || []
      if (candidates.length) {
        normalizedCode = normalizeSecurityCode(candidates[0].code)
        options.resolvedName = candidates[0].name
        await ensureQuoteLoaded(normalizedCode)
      }
      emitPartial()
      return {
        observation: {
          keyword,
          selected: normalizedCode ? { code: normalizedCode, name: stockInfo.name || options.resolvedName || normalizedCode } : null,
          candidates,
        },
        summary: candidates.length
          ? `已识别 ${candidates[0].name}（${normalizeSecurityCode(candidates[0].code)}）`
          : '未检索到匹配股票',
      }
    }

    if (step.tool === 'load_quote') {
      const quoteCode = await resolveCodeIfNeeded((step.query || '').trim())
      await ensureQuoteLoaded(quoteCode)
      emitPartial()
      return {
        observation: {
          stock: {
            code: stockInfo.code,
            name: stockInfo.name,
            price: stockInfo.price,
            changePercent: stockInfo.changePercent,
            turnover: stockInfo.turnover,
          },
          finance,
        },
        summary: buildToolResultSummary(step as AgentPlanStep, stockInfo, finance, klineData, stockNews, macroNews, financialNews, fundFlow, sectorRank, conceptRank, marketIndices, advanceDecline, searchEvidence, financeReport),
      }
    }

    if (step.tool === 'load_market_indices') {
      const response = await withAbort(
        get<{ data: Array<any> }>(`/api/market/indices?market=${marketQuery}`),
        options.abortSignal,
      )
      marketIndices = response.data || []
      emitPartial()
      return {
        observation: marketIndices.slice(0, 5),
        summary: buildToolResultSummary(step as AgentPlanStep, stockInfo, finance, klineData, stockNews, macroNews, financialNews, fundFlow, sectorRank, conceptRank, marketIndices, advanceDecline, searchEvidence, financeReport),
      }
    }

    if (step.tool === 'load_advance_decline') {
      if (marketQuery !== 'a') {
        return {
          observation: { skipped: true, market: marketQuery },
          summary: '当前市场不适用全市场涨跌家数',
        }
      }
      const response = await withAbort(get<{ data: any }>('/api/market/advance-decline'), options.abortSignal)
      advanceDecline = response.data || null
      emitPartial()
      return {
        observation: advanceDecline,
        summary: buildToolResultSummary(step as AgentPlanStep, stockInfo, finance, klineData, stockNews, macroNews, financialNews, fundFlow, sectorRank, conceptRank, marketIndices, advanceDecline, searchEvidence, financeReport),
      }
    }

    if (step.tool === 'load_kline') {
      await resolveCodeIfNeeded()
      const response = await withAbort(
        get<{ data: KlineData[] }>(`/api/kline/${normalizedCode}?period=${period}&adjust=${adjust}`),
        options.abortSignal,
      )
      klineData = response.data || []
      emitPartial()
      return {
        observation: compactKline(),
        summary: buildToolResultSummary(step as AgentPlanStep, stockInfo, finance, klineData, stockNews, macroNews, financialNews, fundFlow, sectorRank, conceptRank, marketIndices, advanceDecline, searchEvidence, financeReport),
      }
    }

    if (step.tool === 'load_stock_news') {
      try {
        const lookupCode = buildNewsLookupCode()
        const lookupName = buildDisplayName()
        const response = await withAbort(
          get<{ data: DiagnosisNewsItem[] }>(`/api/news/stock/${encodeURIComponent(lookupCode)}?limit=16&name=${encodeURIComponent(lookupName)}`),
          options.abortSignal,
        )
        stockNews = response.data || []
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          throw error
        }
        stockNews = []
      }
      emitPartial()
      return {
        observation: compactNews(stockNews),
        summary: buildToolResultSummary(step as AgentPlanStep, stockInfo, finance, klineData, stockNews, macroNews, financialNews, fundFlow, sectorRank, conceptRank, marketIndices, advanceDecline, searchEvidence, financeReport),
      }
    }

    if (step.tool === 'load_macro_news') {
      try {
        const lookupCode = buildNewsLookupCode()
        const lookupName = buildDisplayName()
        const response = await withAbort(
          get<{ data: DiagnosisNewsItem[] }>(`/api/news/context/${encodeURIComponent(lookupCode)}?limit=18&name=${encodeURIComponent(lookupName)}`),
          options.abortSignal,
        )
        macroNews = response.data || []
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          throw error
        }
        macroNews = []
      }
      emitPartial()
      return {
        observation: compactNews(macroNews),
        summary: buildToolResultSummary(step as AgentPlanStep, stockInfo, finance, klineData, stockNews, macroNews, financialNews, fundFlow, sectorRank, conceptRank, marketIndices, advanceDecline, searchEvidence, financeReport),
      }
    }

    if (step.tool === 'load_financial_news') {
      const response = await withAbort(
        get<{ data: DiagnosisNewsItem[] }>('/api/news/financial?limit=60'),
        options.abortSignal,
      )
      financialNews = response.data || []
      emitPartial()
      return {
        observation: compactNews(financialNews, 8),
        summary: buildToolResultSummary(step as AgentPlanStep, stockInfo, finance, klineData, stockNews, macroNews, financialNews, fundFlow, sectorRank, conceptRank, marketIndices, advanceDecline, searchEvidence, financeReport),
      }
    }

    if (step.tool === 'load_fund_flow') {
      await resolveCodeIfNeeded()
      try {
        const stockResponse = await withAbort(
          get<{ data: Array<any> }>(`/api/fundflow/stock/${normalizedCode}?days=10`),
          options.abortSignal,
        )
        const recentFlows = stockResponse.data || []
        if (recentFlows.length) {
          const latest = recentFlows[recentFlows.length - 1]
          fundFlow = {
            name: stockInfo.name,
            code: normalizedCode,
            mainNetInflow: latest.mainNetInflow,
            mainNetInflowPercent: latest.mainNetInflowPercent,
            recentFlows,
          }
        }
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          throw error
        }
        const rankResponse = await withAbort(
          get<{ data: Array<any> }>('/api/fundflow/rank?limit=80'),
          options.abortSignal,
        )
        fundFlow = (rankResponse.data || []).find((item) => normalizeSecurityCode(item.code || '') === normalizedCode) || null
      }
      emitPartial()
      return {
        observation: fundFlow,
        summary: buildToolResultSummary(step as AgentPlanStep, stockInfo, finance, klineData, stockNews, macroNews, financialNews, fundFlow, sectorRank, conceptRank, marketIndices, advanceDecline, searchEvidence, financeReport),
      }
    }

    if (step.tool === 'load_sector_rank') {
      if (marketQuery !== 'a') {
        return {
          observation: { skipped: true, market: marketQuery },
          summary: '当前市场不提供行业板块排行',
        }
      }
      const response = await withAbort(get<{ data: Array<any> }>('/api/sector/industry'), options.abortSignal)
      sectorRank = response.data || []
      emitPartial()
      return {
        observation: sectorRank.slice(0, 8),
        summary: buildToolResultSummary(step as AgentPlanStep, stockInfo, finance, klineData, stockNews, macroNews, financialNews, fundFlow, sectorRank, conceptRank, marketIndices, advanceDecline, searchEvidence, financeReport),
      }
    }

    if (step.tool === 'load_concept_rank') {
      if (marketQuery !== 'a') {
        return {
          observation: { skipped: true, market: marketQuery },
          summary: '当前市场不提供概念板块排行',
        }
      }
      const response = await withAbort(get<{ data: Array<any> }>('/api/sector/concept'), options.abortSignal)
      conceptRank = response.data || []
      emitPartial()
      return {
        observation: conceptRank.slice(0, 8),
        summary: buildToolResultSummary(step as AgentPlanStep, stockInfo, finance, klineData, stockNews, macroNews, financialNews, fundFlow, sectorRank, conceptRank, marketIndices, advanceDecline, searchEvidence, financeReport),
      }
    }

    if (step.tool === 'web_search') {
      if (!availableSearchProviders.length) {
        searchEvidence = await withAbort(
          runWebSearch(post, [], `${describeMarketScope(marketQuery)} ${buildDisplayName()} ${step.query || pickSearchQuery(selectedStrategy, questionFocus)}`),
          options.abortSignal,
        )
        emitPartial()
        return {
          observation: searchEvidence.slice(0, 8).map((item) => ({
            title: item.title,
            source: item.providerName || item.media,
            content: clipText(item.content, 160),
            link: item.link,
          })),
          summary: buildToolResultSummary(step as AgentPlanStep, stockInfo, finance, klineData, stockNews, macroNews, financialNews, fundFlow, sectorRank, conceptRank, marketIndices, advanceDecline, searchEvidence, financeReport),
        }
      }
      const selectedProviders = step.providers?.length
        ? availableSearchProviders.filter((provider) => step.providers?.includes(provider.id) || step.providers?.includes(provider.provider) || step.providers?.includes(provider.name))
        : availableSearchProviders
      const query = `${describeMarketScope(marketQuery)} ${stockInfo.name || options.resolvedName || normalizedCode} ${normalizedCode} ${step.query || pickSearchQuery(selectedStrategy, questionFocus)}`
      searchEvidence = await withAbort(
        runWebSearch(post, selectedProviders.length ? selectedProviders : availableSearchProviders, query),
        options.abortSignal,
      )
      emitPartial()
      return {
        observation: searchEvidence.slice(0, 8).map((item) => ({
          title: item.title,
          source: item.providerName || item.media,
          content: clipText(item.content, 160),
          link: item.link,
        })),
        summary: buildToolResultSummary(step as AgentPlanStep, stockInfo, finance, klineData, stockNews, macroNews, financialNews, fundFlow, sectorRank, conceptRank, marketIndices, advanceDecline, searchEvidence, financeReport),
      }
    }

    if (step.tool === 'load_finance_report') {
      await resolveCodeIfNeeded()
      const response = await withAbort(
        get<{ data: any }>(`/api/finance/summary/${normalizedCode}`),
        options.abortSignal,
      )
      financeReport = response.data || null
      emitPartial()
      return {
        observation: compactFinanceReportData(),
        summary: buildToolResultSummary(step as AgentPlanStep, stockInfo, finance, klineData, stockNews, macroNews, financialNews, fundFlow, sectorRank, conceptRank, marketIndices, advanceDecline, searchEvidence, financeReport),
      }
    }

    return {
      observation: { skipped: true, tool: step.tool },
      summary: `${step.tool} 未执行`,
    }
  }

  throwIfAborted(options.abortSignal)

  if (!options.provider) {
    throw new Error('当前未配置 AI 模型，无法执行智能诊股。')
  }

  if (normalizedCode) {
    await ensureQuoteLoaded(normalizedCode)
  } else if (options.matchCandidates?.length) {
    const topCandidate = options.matchCandidates[0]
    const candidateCode = normalizeSecurityCode(topCandidate.code)
    if (candidateCode) {
      normalizedCode = candidateCode
      options.resolvedName = topCandidate.name
      await ensureQuoteLoaded(normalizedCode)
    }
  } else if (!normalizedCode && (options.resolvedName || options.matchedKeyword)) {
    try {
      await resolveCodeIfNeeded()
      if (normalizedCode) {
        await ensureQuoteLoaded(normalizedCode)
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw error
      }
    }
  }

  const reactTools: ReActTool[] = [
    {
      name: 'search_stock',
      description: '根据用户问题或股票名称搜索股票代码，输出候选列表并锁定本轮研究标的。仅在需要代码时调用。',
      inputSchema: { query: 'string，股票名称/代码/问题片段' },
      execute: (input) => runDiagnosisTool({ tool: 'search_stock', query: `${input.query || ''}` }),
    },
    {
      name: 'load_quote',
      description: '加载实时行情、盘口、估值和涨跌停位置。',
      inputSchema: { code: 'string，可选；不传时使用当前锁定股票' },
      execute: (input) => runDiagnosisTool({ tool: 'load_quote', query: `${input.code || ''}` }),
    },
    {
      name: 'load_kline',
      description: '加载 K 线与量价结构，用于判断趋势、支撑和压力。',
      execute: () => runDiagnosisTool({ tool: 'load_kline' }),
    },
    {
      name: 'load_stock_news',
      description: '按股票名称、代码或问题关键词加载个股相关新闻、公告与经营动态。',
      execute: () => runDiagnosisTool({ tool: 'load_stock_news' }),
    },
    {
      name: 'load_macro_news',
      description: '按股票名称、代码或问题关键词加载和个股关联的政策、行业、宏观与国际消息。',
      execute: () => runDiagnosisTool({ tool: 'load_macro_news' }),
    },
    {
      name: 'load_financial_news',
      description: '加载最新财经要闻，辅助判断外部风险偏好。',
      execute: () => runDiagnosisTool({ tool: 'load_financial_news' }),
    },
    {
      name: 'load_fund_flow',
      description: '加载个股主力资金流和近期净流入趋势。',
      execute: () => runDiagnosisTool({ tool: 'load_fund_flow' }),
    },
    {
      name: 'load_sector_rank',
      description: '加载行业板块热度，用于判断主线和拖累方向。',
      execute: () => runDiagnosisTool({ tool: 'load_sector_rank' }),
    },
    {
      name: 'load_concept_rank',
      description: '加载概念题材热度，用于观察情绪扩散和题材持续性。',
      execute: () => runDiagnosisTool({ tool: 'load_concept_rank' }),
    },
    {
      name: 'load_market_indices',
      description: '加载核心指数表现，用于判断市场风险偏好。',
      execute: () => runDiagnosisTool({ tool: 'load_market_indices' }),
    },
    {
      name: 'load_advance_decline',
      description: '加载全市场涨跌家数和赚钱效应，仅 A 股适用。',
      execute: () => runDiagnosisTool({ tool: 'load_advance_decline' }),
    },
    {
      name: 'load_finance_report',
      description: '加载最近四期财报摘要，补充营收、利润、现金流与资产负债结构。',
      execute: () => runDiagnosisTool({ tool: 'load_finance_report' }),
    },
    {
      name: 'web_search',
      description: '调用外部搜索源获取站外舆情、政策和行业催化。',
      inputSchema: {
        query: 'string，外部搜索关键词',
        providers: 'string[]，可选，搜索源 id/name/provider',
      },
      execute: (input) => runDiagnosisTool({
        tool: 'web_search',
        query: `${input.query || ''}`,
        providers: Array.isArray(input.providers) ? input.providers.map((item) => `${item}`) : undefined,
      }),
    },
  ]

  let agentDiagnosis: AiDiagnosis | null = null

  try {
    const reactResult = await withAbort(withTimeout(runReActLoop<void, AiDiagnosis>({
      provider: options.provider,
      context: undefined,
      tools: reactTools,
      maxTurns: maxSteps,
      abortSignal: options.abortSignal,
      requireFinalAnswer: true,
      finalAnswerSchema: {
        recommendation: '买入/卖出/观望',
        prediction: '看多/看空/震荡',
        confidence: '0-100',
        riskLevel: '低/中/高',
        summary: '必须先回答用户最关心的问题，并严格匹配当前市场时段',
        klineAnalysis: {
          currentPhase: 'string',
          trendDirection: 'up/down/sideways',
          shortTermForecast: '未来1-5日预判',
          mediumTermForecast: '未来1-4周预判',
          keySupportLevels: ['number'],
          keyResistanceLevels: ['number'],
          volumeSignal: 'string',
          maAlignment: 'string',
        },
        supportPrice: 0,
        resistancePrice: 0,
        buyLower: 0,
        buyUpper: 0,
        sellLower: 0,
        sellUpper: 0,
        positionAdvice: 'string',
        positionSize: 'string',
        entryAdvice: 'string',
        exitAdvice: 'string',
        stopLossPrice: 0,
        takeProfitPrice: 0,
        suggestedShares: 0,
        catalysts: ['string'],
        risks: ['string'],
        socialSignals: ['string'],
        policyImpact: 'string',
        internationalFactors: 'string',
        strategyFocus: ['string'],
        evidence: [{ title: 'string', summary: 'string', source: 'string', tone: 'positive|negative|neutral' }],
        scenarios: [
          { label: '1日情景', expectedPrice: 0, probabilityHint: 'string' },
          { label: '5日情景', expectedPrice: 0, probabilityHint: 'string' },
          { label: '20日情景', expectedPrice: 0, probabilityHint: 'string' },
        ],
      },
      planInputSummary: selectedStrategy ? `本次按「${selectedStrategy.name}」评估。` : '本次按默认综合框架评估。',
      planQuery: toolCatalog.map((item) => `${item.tool}:${item.description}`).join(' / '),
      onProgress: (step) => emitProgress(step),
      systemPrompt: `你是股票研究统一智能体。你的职责是围绕“先补齐证据，再形成结论”来决定下一步工具调用。${diagnosisTimingPrompt}
你只能使用内置工具，不能虚构行情、新闻、财报或资金数据。
如果用户给了具体关注点，你要优先拉取能回答该关注点的证据。
能用股票名称、代码或问题关键词直接查询的工具可以先执行；只有实时行情、K线、资金流、财报这类必须依赖股票代码的工具，才需要先进一步确定代码。
在 finish 之前，至少要保证已经拿到实时行情和 K 线；如果问题明显依赖消息面、财报、资金面或市场环境，也要优先补齐对应工具。
对于“现在怎么看、短线空间、能不能买/卖”这类单票问诊，如果已经拿到实时行情、K线、资金流、个股新闻，以及宏观消息或市场指数中的任一类市场环境证据，就必须优先 finish，不要再为了补充可有可无的板块工具而拖延。
最终结论必须直接、明确，不能输出模糊空话。`,
      userPrompt: JSON.stringify({
        task: '针对用户问题进行股票研究并直接输出最终诊断 JSON。',
        goal: '最终需要产出看多/看空/震荡判断、买卖区间、止损止盈、仓位建议，以及对用户关注点的明确回答。',
        questionContext: {
          originalQuestion: options.question || '',
          matchedKeyword: options.matchedKeyword || '',
          resolvedStockName: options.resolvedName || stockInfo.name,
          focus: questionFocus || '默认围绕价格、资金、消息、板块、财报和风险收益比展开',
          candidates: options.matchCandidates?.slice(0, 5) || [],
        },
        stock: stockInfo.code
          ? {
              code: stockInfo.code,
              name: stockInfo.name,
              board: profile.board,
              price: stockInfo.price,
              changePercent: stockInfo.changePercent,
            }
          : null,
        selectedStrategy: selectedStrategyContext,
        marketSession,
        availableSearchProviders: availableSearchProviders.map((item) => ({
          id: item.id,
          name: item.name,
          provider: item.provider,
        })),
        tools: toolCatalog,
        conversationHistory: (options.conversationHistory || []).slice(-10),
      }, null, 2),
      nextStepPrompt: '请判断当前已有数据是否足以完整回答用户问题；如果已经拿到实时行情、K线、资金流、个股新闻，以及宏观消息或市场指数中的任一类市场环境证据，就应直接 finish 并返回最终诊断 JSON；只有确实存在关键缺口时才继续只选择一个最必要的工具。注意同一个失败超过3次的工具不能再调用。',
      toolMaxTokens: 1100,
      toolTimeoutMs: 210000,
    }), planningTimeoutMs, '统一智能体规划'), options.abortSignal)
    trace.push(...reactResult.trace)
    agentDiagnosis = reactResult.finalAnswer || null
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw error
    }
    if (isAuthError(error)) {
      throw new Error(
        `AI 模型认证失败，请检查 API Key 是否有效。${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    }
    const timeoutMessage = error instanceof Error ? error.message : String(error)
    const canFallbackToSynthesis = Boolean(stockInfo.code && klineData.length)
    if (!/超时/i.test(timeoutMessage) || !canFallbackToSynthesis) {
      throw error
    }
    const timeoutStep = createStep({
      kind: 'synthesis',
      title: 'ReAct 超时保护',
      status: 'error',
      strategy: 'ReAct Timeout Guard',
      inputSummary: '关键证据已到位，转入 AI 最终总结',
      resultSummary: timeoutMessage,
      query: options.question || stockInfo.name || stockInfo.code,
      toolOutputText: timeoutMessage,
    })
    trace.push(timeoutStep)
    emitProgress(timeoutStep)
  }

  if (!stockInfo.code || !klineData.length) {
    throw new Error('智能体在结论完成前未补齐实时行情或 K 线数据')
  }

  const technical = buildTechnicalSnapshot(klineData)
  if (!agentDiagnosis) {
    const synthesisRunning = createStep({
      kind: 'synthesis',
      title: '最终结论生成',
      status: 'running',
      strategy: 'AI Final Synthesis',
      inputSummary: '基于已收集证据生成最终诊股 JSON',
      resultSummary: '正在汇总行情、K线、资金、消息和财报证据...',
      query: options.question || stockInfo.name || stockInfo.code,
    })
    trace.push(synthesisRunning)
    emitProgress(synthesisRunning)

    const { chat } = useAiChat()
    try {
      const synthesisPayload = buildSynthesisPayload()
      const synthesisRaw = await withAbort(chat(
        options.provider,
        [
          {
            role: 'system',
            content: `你是股票研究总结智能体。你只能基于用户提供的结构化证据输出最终诊股 JSON，不能虚构任何数据。${diagnosisTimingPrompt}
最终必须输出一个合法 JSON 对象，字段包括：
recommendation, prediction, confidence, riskLevel, summary, klineAnalysis, supportPrice, resistancePrice, buyLower, buyUpper, sellLower, sellUpper, positionAdvice, positionSize, entryAdvice, exitAdvice, stopLossPrice, takeProfitPrice, suggestedShares, catalysts, risks, socialSignals, policyImpact, internationalFactors, strategyFocus, evidence, scenarios。
要求：
1. 所有价位必须与实时价格、支撑压力或已提供证据一致。
2. 结论必须直接回答用户问题，不要空话。
3. 信息不足时直接在对应字段说明证据不足，不要臆测。
4. 保持简洁，summary 不超过 120 字，evidence 和 scenarios 各不超过 3 条。
不要输出 Markdown，不要解释。`,
          },
          {
            role: 'user',
            content: JSON.stringify(synthesisPayload),
          },
        ],
        {
          temperature: 0.15,
          maxTokens: Math.min(Math.max(options.provider.maxTokens || 1100, 900), 1400),
          signal: options.abortSignal,
          timeoutMs: 210000,
        },
      ), options.abortSignal)
      agentDiagnosis = parseJsonBlock<AiDiagnosis>(synthesisRaw)
      const synthesisDone: DiagnosisAgentStep = {
        ...synthesisRunning,
        status: 'done',
        finishedAt: Date.now(),
        durationMs: Date.now() - synthesisRunning.startedAt,
        resultSummary: '已基于完整证据生成最终结论。',
      }
      trace.push(synthesisDone)
      emitProgress(synthesisDone)
    } catch (error) {
      const synthesisError: DiagnosisAgentStep = {
        ...synthesisRunning,
        status: 'error',
        finishedAt: Date.now(),
        durationMs: Date.now() - synthesisRunning.startedAt,
        resultSummary: error instanceof Error ? error.message : String(error),
        toolOutputText: error instanceof Error ? error.message : String(error),
      }
      trace.push(synthesisError)
      emitProgress(synthesisError)
      throw error
    }
  }

  if (!agentDiagnosis) {
    throw new Error('智能体未返回最终诊股结果')
  }

  const marketBreadthEvidence: DiagnosisEvidence[] = []
  if (advanceDecline) {
    const breadth = advanceDecline as MarketBreadthSnapshot
    marketBreadthEvidence.push({
      title: '全市场赚钱效应',
      summary: `涨 ${breadth.advance} / 跌 ${breadth.decline} / 平 ${breadth.flat}，总量能 ${(breadth.totalAmount / 1e9).toFixed(0)} 亿。`,
      source: '市场情绪',
      tone: breadth.advance >= breadth.decline ? 'positive' : 'negative',
    })
  }
  const evidence: DiagnosisEvidence[] = [
    {
      title: `${stockInfo.name} 实时盘口`,
      summary: `现价 ${stockInfo.price.toFixed(2)}，涨跌幅 ${stockInfo.changePercent.toFixed(2)}%，今开 ${stockInfo.open.toFixed(2)}，昨收 ${stockInfo.preClose.toFixed(2)}，换手 ${stockInfo.turnover.toFixed(2)}%。`,
      source: '实时行情',
      tone: stockInfo.changePercent >= 0 ? 'positive' : 'negative',
    },
    {
      title: `${stockInfo.name} 估值快照`,
      summary: `PE ${finance.pe || '--'}，PB ${finance.pb || '--'}，总市值 ${finance.totalMv || '--'}，ROE ${finance.roe || '--'}。`,
      source: '估值数据',
      tone: 'neutral',
    },
    ...stockNews.slice(0, 6).map((item) => ({ title: item.title, summary: item.summary || item.content || '', source: item.source, tone: 'neutral' as const })),
    ...macroNews.slice(0, 6).map((item) => ({ title: item.title, summary: item.summary || item.content || '', source: item.source, tone: isNegativeSignal(`${item.title} ${item.summary || item.content || ''}`) ? 'negative' as const : 'neutral' as const })),
    ...marketIndices.slice(0, 2).map((item) => ({
      title: `${item.name} 指数环境`,
      summary: `${item.name} 当前 ${item.price}，涨跌幅 ${item.changePercent}% ，可作为市场风险偏好参考。`,
      source: '市场指数',
      tone: item.changePercent >= 0 ? 'positive' as const : 'negative' as const,
    })),
    ...sectorRank.slice(0, 4).map((item) => ({
      title: `${item.name} 行业热度`,
      summary: `行业涨跌幅 ${item.changePercent}% ，领涨股 ${item.leadingStock || '待同步'}。`,
      source: '行业板块',
      tone: item.changePercent >= 0 ? 'positive' as const : 'negative' as const,
    })),
    ...conceptRank.slice(0, 4).map((item) => ({
      title: `${item.name} 概念热度`,
      summary: `概念涨跌幅 ${item.changePercent}% ，领涨股 ${item.leadingStock || '待同步'}。`,
      source: '概念板块',
      tone: item.changePercent >= 0 ? 'positive' as const : 'negative' as const,
    })),
    ...(fundFlow
      ? [{
          title: `${stockInfo.name} 主力资金`,
          summary: fundFlow.recentFlows?.length
            ? `近${fundFlow.recentFlows.length}日：${fundFlow.recentFlows.slice(-3).map((d: any) => `${d.date} 净流入${d.mainNetInflow > 0 ? '+' : ''}${d.mainNetInflow?.toFixed(0)}`).join('；')}，最新占比 ${fundFlow.mainNetInflowPercent}%`
            : `主力净流入 ${fundFlow.mainNetInflow}，占比 ${fundFlow.mainNetInflowPercent}% 。`,
          source: '资金流',
          tone: fundFlow.mainNetInflow >= 0 ? 'positive' as const : 'negative' as const,
        }]
      : []),
    ...marketBreadthEvidence,
    ...financialNews.slice(0, 8).map((item) => ({ title: item.title, summary: item.summary || item.content || '', source: item.source || '财经要闻', tone: isNegativeSignal(`${item.title} ${item.summary || ''}`) ? 'negative' as const : 'neutral' as const })),
    ...searchEvidence.slice(0, 8).map((item) => ({ title: item.title, summary: item.content, source: item.providerName || item.media || '外部搜索', tone: isNegativeSignal(`${item.title} ${item.content}`) ? 'negative' as const : 'neutral' as const })),
    ...(financeReport?.incomeStatement?.length
      ? [{
          title: `${stockInfo.name} 财报趋势`,
          summary: `近${financeReport.incomeStatement.length}期：最新营收 ${(financeReport.incomeStatement[0].totalRevenue / 1e8).toFixed(2)}亿，净利润 ${(financeReport.incomeStatement[0].netProfit / 1e8).toFixed(2)}亿${financeReport.cashflowStatement?.[0] ? `，经营现金流 ${(financeReport.cashflowStatement[0].operatingCashFlow / 1e8).toFixed(2)}亿` : ''}${financeReport.balanceSheet?.[0] ? `，总资产 ${(financeReport.balanceSheet[0].totalAssets / 1e8).toFixed(2)}亿，负债率 ${((financeReport.balanceSheet[0].totalLiabilities / financeReport.balanceSheet[0].totalAssets) * 100).toFixed(1)}%` : ''}`,
          source: '财报数据',
          tone: (financeReport.incomeStatement.length >= 2 && financeReport.incomeStatement[0].netProfit >= financeReport.incomeStatement[1].netProfit) ? 'positive' as const : 'neutral' as const,
        }]
      : []),
  ]

  const diagnosis = sanitizeDiagnosis({
    ...agentDiagnosis,
    evidence: agentDiagnosis.evidence?.length ? agentDiagnosis.evidence : evidence,
    toolCalls: trace,
    generatedAt: Date.now(),
  }, trace, evidence)
  const llmSummary = {
    used: true,
    notice: `本轮已调用 ${options.provider.name} 完成研究与结论生成。`,
  }

  return {
    stockInfo,
    finance,
    klineData,
    stockNews,
    macroNews,
    financeReport,
    technical,
    diagnosis,
    trace,
    policyEvidence: diagnosis.evidence || evidence,
    selectedStrategy: selectedStrategyContext,
    llmSummary,
  }
}
