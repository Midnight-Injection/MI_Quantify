import { useAiChat } from '@/composables/useAiChat'
import { useSidecar } from '@/composables/useSidecar'
import type { AiDiagnosis, AiProvider, DiagnosisAgentStep, DiagnosisEvidence, KlineData, SearchProvider, Strategy, TechnicalSnapshot } from '@/types'
import { buildTechnicalSnapshot, getLimitPrices, getStockProfile } from '@/utils/marketMetrics'
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
    | 'load_quote'
    | 'load_kline'
    | 'load_stock_news'
    | 'load_macro_news'
    | 'load_fund_flow'
    | 'load_sector_rank'
    | 'load_concept_rank'
    | 'load_market_indices'
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

export interface DiagnosisAgentResult {
  stockInfo: DiagnosisStockInfo
  finance: DiagnosisFinanceInfo
  klineData: KlineData[]
  stockNews: DiagnosisNewsItem[]
  macroNews: DiagnosisNewsItem[]
  technical: TechnicalSnapshot
  diagnosis: AiDiagnosis
  trace: DiagnosisAgentStep[]
  policyEvidence: DiagnosisEvidence[]
  selectedStrategy: StrategyContext | null
}

export interface DiagnosisAgentProgressEvent {
  step: DiagnosisAgentStep
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
    case 'load_kline':
      return 'K线结构、均线、MACD、RSI、成交量、支撑压力'
    case 'load_stock_news':
      return '公司公告、产品进展、订单、回购、经营动态'
    case 'load_macro_news':
      return '政策导向、宏观事件、行业景气度、社会面消息'
    case 'load_fund_flow':
      return '主力净流入、量能变化、资金偏好'
    case 'load_sector_rank':
      return '所属行业热度、板块强弱、龙头股表现'
    case 'load_concept_rank':
      return '相关概念题材热度、情绪扩散、活跃龙头'
    case 'web_search':
      return strategy ? `${strategy.name} 相关外部舆情、政策和市场讨论` : '外部舆情、政策导向、公司战略与市场讨论'
  }
}

function humanizeAgentError(message: string) {
  if (/429|Too Many Requests|余额不足|无可用资源包/i.test(message)) {
    return '模型调用额度不足，已自动切换为本地回退分析流程，页面结论仍基于实时行情和已采集证据生成。'
  }
  if (/web search failed/i.test(message)) {
    return '外部搜索暂时不可用，本轮仅使用站内实时行情、资讯和板块数据继续分析。'
  }
  if (/Failed to fetch|NetworkError|fetch/i.test(message)) {
    return '网络请求失败，本轮分析缺少部分远端数据，建议稍后重试。'
  }
  return message
}

function escapeRegExp(input: string) {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
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
    { tool: 'load_quote', module: 'stock.quote', description: '读取实时价格、涨跌、估值、五档盘口和涨跌停位置。' },
    { tool: 'load_market_indices', module: 'market.indices', description: '读取上证、深证、创业板等大盘指数与市场风格。' },
    { tool: 'load_kline', module: 'stock.kline', description: '读取日线或其他周期 K 线、均线、MACD、RSI、量能和支撑压力。' },
    { tool: 'load_stock_news', module: 'news.stock', description: '读取个股公告、公司新闻、订单、回购和经营动态。' },
    { tool: 'load_macro_news', module: 'news.market', description: '读取财经快讯、政策导向、宏观事件和行业景气度。' },
    { tool: 'load_fund_flow', module: 'capital.flow', description: '读取主力净流入、资金偏好和量能变化。' },
    { tool: 'load_sector_rank', module: 'sector.industry', description: '读取行业热度、行业涨跌幅和龙头表现。' },
    { tool: 'load_concept_rank', module: 'sector.concept', description: '读取概念题材热度、情绪扩散和活跃龙头。' },
  ]

  if (searchProviders.length) {
    tools.push({
      tool: 'web_search',
      module: 'search.web',
      description: `补充外部舆情、政策消息、行业讨论和国际热点。可用搜索源：${searchProviders.map((item) => item.name).join('、')}`,
    })
  }

  return tools
}

function pickSearchQuery(strategy?: Strategy | null, questionFocus?: string) {
  const focus = questionFocus ? ` ${questionFocus}` : ''
  if (!strategy) return `政策导向 公司战略 行业景气度 社会舆情${focus}`
  if (strategy.category === 'fundamental') return `${strategy.name} 政策导向 公司战略 行业景气度 机构观点${focus}`
  if (strategy.category === 'volume') return `${strategy.name} 成交量变化 放量原因 主力行为${focus}`
  if (strategy.category === 'pattern' || strategy.category === 'trend') return `${strategy.name} 龙头板块 市场风格 情绪变化${focus}`
  if (strategy.category === 'momentum') return `${strategy.name} 强弱切换 相对强度 资金偏好${focus}`
  return `${strategy.name} 政策导向 公司战略 社会舆情${focus}`
}

function fallbackPlan(searchEnabled: boolean, strategy?: Strategy | null): AgentPlanStep[] {
  const toolOrder =
    strategy?.category === 'fundamental'
      ? ['load_quote', 'load_market_indices', 'load_stock_news', 'load_macro_news', 'load_sector_rank', 'load_concept_rank', 'load_fund_flow', 'load_kline']
      : strategy?.category === 'volume'
        ? ['load_quote', 'load_kline', 'load_fund_flow', 'load_market_indices', 'load_sector_rank', 'load_concept_rank', 'load_stock_news', 'load_macro_news']
        : strategy?.category === 'pattern' || strategy?.category === 'trend' || strategy?.category === 'momentum' || strategy?.category === 'mean_reversion'
          ? ['load_quote', 'load_kline', 'load_market_indices', 'load_fund_flow', 'load_sector_rank', 'load_concept_rank', 'load_stock_news', 'load_macro_news']
          : ['load_quote', 'load_market_indices', 'load_kline', 'load_stock_news', 'load_macro_news', 'load_fund_flow', 'load_sector_rank', 'load_concept_rank']

  const reasonMap: Record<AgentPlanStep['tool'], string> = {
    load_quote: '先锁定当前价格、盘口、估值和涨跌停位置。',
    load_market_indices: '确认指数环境和市场风格是否支持个股方向。',
    load_kline: '提取 K 线、均线、量能、支撑和压力。',
    load_stock_news: '提取公司近端催化、公告、澄清和风险。',
    load_macro_news: '补充市场整体风险偏好、政策环境和宏观扰动。',
    load_fund_flow: '确认主力资金、量能变化和情绪方向。',
    load_sector_rank: '判断当前行业主线和个股所在行业热度。',
    load_concept_rank: '补充概念题材是否处于扩散阶段。',
    web_search: '补充社会面、政策导向、公司未来战略和市场讨论。',
  }

  const plan: AgentPlanStep[] = toolOrder.map((tool) => ({
    tool: tool as AgentPlanStep['tool'],
    reason: reasonMap[tool as AgentPlanStep['tool']],
  }))

  if (searchEnabled) {
    plan.push({
      tool: 'web_search',
      reason: reasonMap.web_search,
      query: pickSearchQuery(strategy),
    })
  }

  return plan
}

function buildStrategyFocus(strategy: Strategy | null | undefined, technical: TechnicalSnapshot, evidence: DiagnosisEvidence[]) {
  const fallback = technical.trend === 'bullish'
    ? ['趋势延续', '量价确认', '支撑防守']
    : ['技术面优先', '消息面交叉验证', '仓位先行控制']
  if (!strategy) return fallback
  return [
    strategy.name,
    strategy.notes?.split('。').find(Boolean) || strategy.description,
    evidence[0]?.source ? `${evidence[0].source}交叉验证` : '实时数据交叉验证',
  ].slice(0, 3)
}

function buildToolInputSummary(step: AgentPlanStep, stockInfo: DiagnosisStockInfo, strategy: Strategy | null | undefined, period: string, adjust: string) {
  const strategyName = strategy?.name || '默认综合框架'
  switch (step.tool) {
    case 'load_quote':
      return `读取 ${stockInfo.name} 的实时价格、盘口五档、估值和涨跌停位置；评估方式采用 ${strategyName}。`
    case 'load_market_indices':
      return '读取上证、深证、创业板等市场指数，确认当前大盘风险偏好和风格。'
    case 'load_kline':
      return `读取 ${period} / ${adjust} K 线，关注均线、MACD、RSI、成交量和关键支撑压力。`
    case 'load_stock_news':
      return `读取 ${stockInfo.name} 近端公司新闻、公告、回购、订单和经营动态。`
    case 'load_macro_news':
      return `读取与 ${stockInfo.name} 直接相关的政策、国际、行业和社会面消息。`
    case 'load_fund_flow':
      return `读取 ${stockInfo.name} 所在资金流榜与主力净流入数据，确认量能与资金偏好。`
    case 'load_sector_rank':
      return `读取 ${stockInfo.name} 所属行业与行业热度榜，确认主线行业强弱。`
    case 'load_concept_rank':
      return `读取 ${stockInfo.name} 相关概念题材与题材热度榜，确认情绪是否扩散。`
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
  fundFlow: any,
  sectorRank: any[],
  conceptRank: any[],
  marketIndices: Array<{ code: string; name: string; price: number; changePercent: number }>,
  searchEvidence: SearchResultItem[],
) {
  switch (step.tool) {
    case 'load_quote':
      return `${stockInfo.name} ${stockInfo.price.toFixed(2)}，涨跌 ${stockInfo.changePercent.toFixed(2)}%，换手 ${stockInfo.turnover.toFixed(2)}%，PE ${finance.pe || '--'}，PB ${finance.pb || '--'}`
    case 'load_market_indices':
      return `读取 ${marketIndices.length} 个市场指数，前排：${marketIndices.slice(0, 3).map((item) => item.name).join('、') || '暂无'}`
    case 'load_kline':
      return `读取 ${klineData.length} 根 K 线，最近收盘 ${klineData[klineData.length - 1]?.close?.toFixed(2) || '--'}`
    case 'load_stock_news':
      return `读取 ${stockNews.length} 条个股新闻，最新：${stockNews[0]?.title || '暂无'}`
    case 'load_macro_news':
      return `读取 ${macroNews.length} 条相关政策/国际消息，最新：${macroNews[0]?.title || '暂无'}`
    case 'load_fund_flow':
      return fundFlow ? `匹配到资金流记录 ${fundFlow.name}，主力净流入 ${fundFlow.mainNetInflow}` : '未匹配到资金流数据'
    case 'load_sector_rank':
      return `读取 ${sectorRank.length} 个行业板块，前排：${sectorRank.slice(0, 3).map((item) => item.name).join('、') || '暂无'}`
    case 'load_concept_rank':
      return `读取 ${conceptRank.length} 个概念板块，前排：${conceptRank.slice(0, 3).map((item) => item.name).join('、') || '暂无'}`
    case 'web_search':
      return `读取 ${searchEvidence.length} 条外部搜索结果，最新：${searchEvidence[0]?.title || '暂无'}`
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

function buildCatalystHints(
  stockInfo: DiagnosisStockInfo,
  stockNews: DiagnosisNewsItem[],
  macroNews: DiagnosisNewsItem[],
  searchEvidence: SearchResultItem[],
  sectorRank: any[],
  conceptRank: any[],
  fundFlow: any,
  technical: TechnicalSnapshot,
) {
  return dedupeStrings([
    ...stockNews.slice(0, 3).map((item) => `公司消息：${clipText(item.title, 34)}`),
    ...macroNews.slice(0, 2).map((item) => `外部刺激：${clipText(item.title, 34)}`),
    ...searchEvidence.slice(0, 2).map((item) => `${item.providerName || item.media || '外部搜索'}：${clipText(item.title, 32)}`),
    fundFlow && Number(fundFlow.mainNetInflow) > 0
      ? `资金面：主力净流入 ${fundFlow.mainNetInflow}，短线承接仍在`
      : '',
    sectorRank[0]
      ? `行业热度：${sectorRank[0].name} 涨跌幅 ${sectorRank[0].changePercent}%`
      : '',
    conceptRank[0]
      ? `概念扩散：${conceptRank[0].name} 活跃，情绪仍有扩散空间`
      : '',
    technical.trend === 'bullish'
      ? `价格结构：现价 ${stockInfo.price.toFixed(2)} 仍在支撑 ${technical.supportPrice.toFixed(2)} 上方`
      : '',
  ], 5)
}

function buildRiskHints(
  stockInfo: DiagnosisStockInfo,
  macroNews: DiagnosisNewsItem[],
  searchEvidence: SearchResultItem[],
  marketIndices: Array<{ code: string; name: string; price: number; changePercent: number }>,
  fundFlow: any,
  technical: TechnicalSnapshot,
) {
  const negativeNews = [
    ...macroNews.filter((item) => isNegativeSignal(`${item.title} ${item.summary || item.content || ''}`)).slice(0, 2).map((item) => `外部扰动：${clipText(item.title, 34)}`),
    ...searchEvidence.filter((item) => isNegativeSignal(`${item.title} ${item.content}`)).slice(0, 2).map((item) => `舆情扰动：${clipText(item.title, 34)}`),
  ]

  return dedupeStrings([
    ...negativeNews,
    fundFlow && Number(fundFlow.mainNetInflow) < 0
      ? `资金面：主力净流入 ${fundFlow.mainNetInflow}，短线抛压仍需防守`
      : '',
    marketIndices.some((item) => Number(item.changePercent) < 0)
      ? `市场环境：${marketIndices.filter((item) => Number(item.changePercent) < 0).slice(0, 2).map((item) => item.name).join('、')}偏弱，风险偏好不足`
      : '',
    technical.trend === 'bearish' || technical.momentum === 'weak'
      ? `技术面：若跌破 ${technical.supportPrice.toFixed(2)}，节奏容易继续转弱`
      : `风控位：短线失守 ${technical.supportPrice.toFixed(2)} 需及时降仓`,
    `价格波动：当前振幅与换手需结合 ${stockInfo.preClose.toFixed(2)} 一线防守`,
  ], 5)
}

function buildImpactHints(
  macroNews: DiagnosisNewsItem[],
  searchEvidence: SearchResultItem[],
  marketIndices: Array<{ code: string; name: string; price: number; changePercent: number }>,
  sectorRank: any[],
) {
  return dedupeStrings([
    ...macroNews.slice(0, 3).map((item) => `${item.source || '市场消息'}：${clipText(item.title, 34)}`),
    ...searchEvidence.slice(0, 3).map((item) => `${item.providerName || item.media || '外部搜索'}：${clipText(item.title || item.content, 34)}`),
    ...marketIndices.slice(0, 2).map((item) => `${item.name} ${item.changePercent}% ，影响整体风险偏好`),
    sectorRank[0]
      ? `${sectorRank[0].name} 为当前行业风向参考，需观察板块热度是否延续`
      : '',
  ], 5)
}

function sanitizeDiagnosis(
  diagnosis: AiDiagnosis,
  stockInfo: DiagnosisStockInfo,
  technical: TechnicalSnapshot,
  trace: DiagnosisAgentStep[],
  evidence: DiagnosisEvidence[],
  derived: {
    catalysts: string[]
    risks: string[]
    impacts: string[]
  },
) {
  const lotSize = getStockProfile(stockInfo.code).lotSize
  const support = technical.supportPrice || diagnosis.supportPrice || Number((stockInfo.price * 0.97).toFixed(2))
  const resistance = technical.resistancePrice || diagnosis.resistancePrice || Number((stockInfo.price * 1.04).toFixed(2))
  const buyLowerBase = Math.min(support, stockInfo.price)
  const buyUpperBase = Math.min(stockInfo.price * 1.02, Math.max(stockInfo.price, resistance))
  const sellLowerBase = Math.max(stockInfo.price * 1.01, buyUpperBase * 1.015)
  const sellUpperBase = Math.max(sellLowerBase * 1.01, resistance)
  const suggestedLots = Math.max(1, Math.round((diagnosis.suggestedShares || lotSize) / lotSize))

  return {
    ...diagnosis,
    confidence: clamp(Math.round(diagnosis.confidence || 55), 18, 88),
    supportPrice: Number((diagnosis.supportPrice || support).toFixed(2)),
    resistancePrice: Number((diagnosis.resistancePrice || resistance).toFixed(2)),
    buyLower: Number(clamp(diagnosis.buyLower || buyLowerBase, buyLowerBase * 0.98, stockInfo.price).toFixed(2)),
    buyUpper: Number(clamp(diagnosis.buyUpper || buyUpperBase, buyLowerBase, Math.max(stockInfo.price * 1.02, buyUpperBase)).toFixed(2)),
    sellLower: Number(clamp(diagnosis.sellLower || sellLowerBase, stockInfo.price * 1.005, sellUpperBase).toFixed(2)),
    sellUpper: Number(clamp(diagnosis.sellUpper || sellUpperBase, sellLowerBase, sellUpperBase * 1.05).toFixed(2)),
    stopLossPrice: Number(clamp(diagnosis.stopLossPrice || support * 0.97, support * 0.92, stockInfo.price * 0.99).toFixed(2)),
    takeProfitPrice: Number(clamp(diagnosis.takeProfitPrice || sellUpperBase, sellLowerBase, sellUpperBase * 1.08).toFixed(2)),
    suggestedShares: suggestedLots * lotSize,
    catalysts: diagnosis.catalysts?.length ? diagnosis.catalysts.slice(0, 5) : derived.catalysts,
    risks: diagnosis.risks?.length ? diagnosis.risks.slice(0, 5) : derived.risks,
    socialSignals: diagnosis.socialSignals?.length ? diagnosis.socialSignals.slice(0, 5) : derived.impacts,
    evidence: diagnosis.evidence?.length ? diagnosis.evidence.slice(0, 8) : evidence,
    toolCalls: trace,
    generatedAt: Date.now(),
  }
}

function buildFallbackDiagnosis(
  stockInfo: DiagnosisStockInfo,
  technical: TechnicalSnapshot,
  trace: DiagnosisAgentStep[],
  evidence: DiagnosisEvidence[],
  derived: {
    catalysts: string[]
    risks: string[]
    impacts: string[]
  },
  strategy?: Strategy | null,
): AiDiagnosis {
  const bullish = technical.trend === 'bullish'
  const support = technical.supportPrice || Number((stockInfo.price * 0.97).toFixed(2))
  const resistance = technical.resistancePrice || Number((stockInfo.price * 1.04).toFixed(2))
  return {
    recommendation: bullish ? '回踩低吸' : technical.trend === 'bearish' ? '观望防守' : '区间交易',
    prediction: bullish ? '震荡偏强' : technical.trend === 'bearish' ? '弱势震荡' : '区间震荡',
    confidence: bullish ? 63 : 51,
    riskLevel: technical.momentum === 'weak' ? '高' : '中',
    summary: bullish
      ? '技术面维持偏强结构，适合等待回踩支撑后的确认买点，不宜离支撑位过远追价。'
      : '当前结构未形成高把握度趋势，建议以支撑防守和仓位控制为先。',
    supportPrice: support,
    resistancePrice: resistance,
    buyLower: support,
    buyUpper: Number((support * 1.01).toFixed(2)),
    sellLower: Number((resistance * 0.985).toFixed(2)),
    sellUpper: resistance,
    positionAdvice: bullish ? '建议 20%-35% 试探仓位，确认放量再逐步加仓。' : '建议轻仓观察，等待量价改善再考虑参与。',
    positionSize: bullish ? '轻仓到中仓' : '轻仓',
    entryAdvice: `优先等待 ${support.toFixed(2)} 附近承接确认后分批买入。`,
    exitAdvice: `若反弹至 ${resistance.toFixed(2)} 一带但量能未继续放大，可分批止盈。`,
    stopLossPrice: Number((support * 0.97).toFixed(2)),
    takeProfitPrice: resistance,
    suggestedShares: Math.max(100, getStockProfile(stockInfo.code).lotSize),
    catalysts: derived.catalysts,
    risks: derived.risks,
    socialSignals: derived.impacts,
    scenarios: [
      { label: '1日情景', expectedPrice: stockInfo.price, probabilityHint: '等待盘中资金确认' },
      { label: '3日情景', expectedPrice: Number(((stockInfo.price + support) / 2).toFixed(2)), probabilityHint: '观察回踩支撑有效性' },
      { label: '5日情景', expectedPrice: resistance, probabilityHint: '放量时才有进一步上测空间' },
    ],
    strategyFocus: buildStrategyFocus(strategy, technical, evidence),
    evidence,
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
    limit: 8,
    providers: searchProviders.map((provider) => ({
      id: provider.id,
      name: provider.name,
      provider: provider.provider,
      apiUrl: provider.apiUrl,
      apiKey: provider.apiKey,
      enabled: provider.enabled,
    })),
  })
  return payload.data || []
}

export async function runDiagnosisAgent(options: {
  code: string
  provider: AiProvider | null
  searchProviders?: SearchProvider[] | null
  activeSearchProvider?: SearchProvider | null
  maxSteps?: number
  period?: string
  adjust?: string
  selectedStrategy?: Strategy | null
  question?: string
  resolvedName?: string
  matchedKeyword?: string
  matchCandidates?: Array<{ code: string; name: string }>
  onProgress?: (event: DiagnosisAgentProgressEvent) => void
}): Promise<DiagnosisAgentResult> {
  const { get, post } = useSidecar()
  const { chat } = useAiChat()
  const normalizedCode = normalizeSecurityCode(options.code)
  const period = options.period || 'daily'
  const adjust = options.adjust || 'qfq'
  const trace: DiagnosisAgentStep[] = []
  const selectedStrategy = options.selectedStrategy || null
  const selectedStrategyContext = createStrategyContext(selectedStrategy)
  const availableSearchProviders = normalizeSearchProviders(options.searchProviders, options.activeSearchProvider)
  const toolCatalog = buildToolCatalog(availableSearchProviders)
  const emitProgress = (step: DiagnosisAgentStep) => {
    options.onProgress?.({ step })
  }

  const quoteRes = await get<{ info: DiagnosisStockInfo; finance: DiagnosisFinanceInfo }>(`/api/market/stock/${normalizedCode}/info`)
  const stockInfo = {
    ...quoteRes.info,
    code: normalizeSecurityCode(quoteRes.info.code || normalizedCode),
  }
  const finance = quoteRes.finance
  const profile = getStockProfile(stockInfo.code)
  const limitPrices = getLimitPrices(stockInfo.code, stockInfo.preClose)
  const questionFocus = buildQuestionFocus(options.question, stockInfo.name, options.matchedKeyword)

  const searchEnabled = availableSearchProviders.length > 0
  let plan = fallbackPlan(searchEnabled, selectedStrategy)
  const planStepId = `plan_${Date.now()}`
  emitProgress({
    id: planStepId,
    kind: 'plan',
    title: '研究路径规划',
    status: 'running',
    strategy: options.provider ? 'LLM Planner' : 'Fallback Planner',
    inputSummary: selectedStrategy ? `本次按「${selectedStrategy.name}」评估。` : '本次按默认综合框架评估。',
    resultSummary: '正在规划研究顺序与关注重点...',
    query: fallbackPlan(searchEnabled, selectedStrategy).map((item) => describeToolFocus(item.tool, selectedStrategy)).join(' / '),
    startedAt: Date.now(),
    finishedAt: Date.now(),
    durationMs: 0,
  })

  if (options.provider) {
    try {
      const rawPlan = await chat(
        options.provider,
        [
          {
            role: 'system',
            content: '你是 A 股研究 Agent 规划器。你只能调度给定的内置股票研究工具，不能虚构数据源，也不能跳过用户问题中的关键关注点。若可用多个搜索源，web_search 步骤可以输出 providers 数组指定 1-3 个搜索源 id。请输出 JSON：{"steps":[{"tool":"...","reason":"...","query":"...","providers":["..."]}]}。',
          },
          {
            role: 'user',
            content: JSON.stringify({
              questionContext: {
                originalQuestion: options.question || '',
                matchedKeyword: options.matchedKeyword || '',
                resolvedStockName: options.resolvedName || stockInfo.name,
                candidates: options.matchCandidates?.slice(0, 5) || [],
                focus: questionFocus || '默认围绕价格、资金、消息、板块和风险收益比展开',
              },
              stock: {
                code: stockInfo.code,
                name: stockInfo.name,
                board: profile.board,
                price: stockInfo.price,
                changePercent: stockInfo.changePercent,
              },
              selectedStrategy: selectedStrategyContext,
              tools: toolCatalog,
              availableSearchProviders: availableSearchProviders.map((item) => ({
                id: item.id,
                name: item.name,
                provider: item.provider,
              })),
              goal: '需要形成买入区间、卖出区间、止损止盈和仓位建议；如果传入了评估策略，要优先按该策略组织研究顺序；如果用户问题里带有具体关注点，要优先安排对应工具。',
              maxSteps: Math.max(4, Math.min(options.maxSteps || 6, 7)),
            }),
          },
        ],
        { temperature: 0.1, maxTokens: 800 },
      )
      const parsedPlan = parseJsonBlock<{ steps?: AgentPlanStep[] }>(rawPlan)
      if (parsedPlan.steps?.length) {
        const availableSearchKeys = new Set(availableSearchProviders.flatMap((item) => [item.id, item.provider, item.name]))
        plan = parsedPlan.steps
          .filter((step) => step.tool !== 'web_search' || searchEnabled)
          .map((step) => ({
            ...step,
            providers: step.providers?.filter((item) => availableSearchKeys.has(item)),
          }))
          .slice(0, options.maxSteps || 6)
      }
      if (!plan.some((step) => step.tool === 'load_quote')) {
        plan.unshift({ tool: 'load_quote', reason: '先确认实时价格、盘口、估值与涨跌停位置。' })
      }
      const planStep = {
        id: planStepId,
        kind: 'plan' as const,
        title: '研究路径规划',
        status: 'done' as const,
        strategy: 'LLM Planner',
        inputSummary: selectedStrategy ? `本次按「${selectedStrategy.name}」评估。` : '本次按默认综合框架评估。',
        resultSummary: plan.map((item, index) => `${index + 1}. ${item.tool}`).join(' -> '),
        query: plan.map((item) => describeToolFocus(item.tool, selectedStrategy)).join(' / '),
        startedAt: Date.now(),
        finishedAt: Date.now(),
        durationMs: 0,
      }
      trace.push(planStep)
      emitProgress(planStep)
    } catch (error) {
      const planStep = {
        id: planStepId,
        kind: 'plan' as const,
        title: '研究路径规划',
        status: 'error' as const,
        strategy: 'Fallback Planner',
        inputSummary: selectedStrategy ? `本次按「${selectedStrategy.name}」评估。` : '本次按默认综合框架评估。',
        resultSummary: humanizeAgentError(error instanceof Error ? error.message : String(error)),
        query: plan.map((item) => describeToolFocus(item.tool, selectedStrategy)).join(' / '),
        startedAt: Date.now(),
        finishedAt: Date.now(),
        durationMs: 0,
      }
      trace.push(planStep)
      emitProgress(planStep)
    }
  } else {
    const planStep = {
      id: planStepId,
      kind: 'plan' as const,
      title: '研究路径规划',
      status: 'skipped' as const,
      strategy: 'Fallback Planner',
      inputSummary: selectedStrategy ? `本次按「${selectedStrategy.name}」评估。` : '本次按默认综合框架评估。',
      resultSummary: '未配置模型，已切换到本地固定研究序列。',
      query: plan.map((item) => describeToolFocus(item.tool, selectedStrategy)).join(' / '),
      startedAt: Date.now(),
      finishedAt: Date.now(),
      durationMs: 0,
    }
    trace.push(planStep)
    emitProgress(planStep)
  }

  let klineData: KlineData[] = []
  let stockNews: DiagnosisNewsItem[] = []
  let macroNews: DiagnosisNewsItem[] = []
  let fundFlow: any = null
  let sectorRank: any[] = []
  let conceptRank: any[] = []
  let marketIndices: Array<{ code: string; name: string; price: number; changePercent: number }> = []
  let searchEvidence: SearchResultItem[] = []

  for (const step of plan.slice(0, options.maxSteps || 6)) {
    const startedAt = Date.now()
    const stepId = `${step.tool}_${startedAt}`
    emitProgress({
      id: stepId,
      kind: 'tool',
      title: step.reason,
      status: 'running',
      tool: step.tool,
      strategy: step.reason,
      query: step.query || describeToolFocus(step.tool, selectedStrategy),
      inputSummary: buildToolInputSummary(step, stockInfo, selectedStrategy, period, adjust),
      resultSummary: '执行中...',
      startedAt,
      finishedAt: startedAt,
      durationMs: 0,
    })
    try {
      if (step.tool === 'load_market_indices') {
        const response = await get<{ data: Array<any> }>('/api/market/indices?market=a')
        marketIndices = response.data || []
      }
      if (step.tool === 'load_kline') {
        const response = await get<{ data: KlineData[] }>(`/api/kline/${normalizedCode}?period=${period}&adjust=${adjust}`)
        klineData = response.data || []
      }
      if (step.tool === 'load_stock_news') {
        const response = await get<{ data: DiagnosisNewsItem[] }>(`/api/news/stock/${normalizedCode}?limit=8`)
        stockNews = response.data || []
      }
      if (step.tool === 'load_macro_news') {
        const response = await get<{ data: DiagnosisNewsItem[] }>(`/api/news/context/${normalizedCode}?limit=10`)
        macroNews = response.data || []
      }
      if (step.tool === 'load_fund_flow') {
        const response = await get<{ data: Array<any> }>('/api/fundflow/rank?limit=80')
        fundFlow = (response.data || []).find((item) => normalizeSecurityCode(item.code || '') === normalizedCode) || null
      }
      if (step.tool === 'load_sector_rank') {
        const response = await get<{ data: Array<any> }>('/api/sector/industry')
        sectorRank = response.data || []
      }
      if (step.tool === 'load_concept_rank') {
        const response = await get<{ data: Array<any> }>('/api/sector/concept')
        conceptRank = response.data || []
      }
      if (step.tool === 'web_search' && availableSearchProviders.length) {
        const query = `${stockInfo.name} ${stockInfo.code} ${step.query || pickSearchQuery(selectedStrategy, questionFocus)}`
        const selectedProviders = step.providers?.length
          ? availableSearchProviders.filter((provider) => step.providers?.includes(provider.id) || step.providers?.includes(provider.provider) || step.providers?.includes(provider.name))
          : availableSearchProviders
        searchEvidence = await runWebSearch(post, selectedProviders.length ? selectedProviders : availableSearchProviders, query)
      }

      const traceStep: DiagnosisAgentStep = {
        id: stepId,
        kind: 'tool',
        title: step.reason,
        status: 'done',
        tool: step.tool,
        strategy: step.reason,
        query: step.query || describeToolFocus(step.tool, selectedStrategy),
        inputSummary: buildToolInputSummary(step, stockInfo, selectedStrategy, period, adjust),
        resultSummary: buildToolResultSummary(
          step,
          stockInfo,
          finance,
          klineData,
          stockNews,
          macroNews,
          fundFlow,
          sectorRank,
          conceptRank,
          marketIndices,
          searchEvidence,
        ),
        startedAt,
        finishedAt: Date.now(),
        durationMs: Date.now() - startedAt,
      }
      trace.push(traceStep)
      emitProgress(traceStep)
    } catch (error) {
      const traceStep: DiagnosisAgentStep = {
        id: stepId,
        kind: 'tool',
        title: step.reason,
        status: 'error',
        tool: step.tool,
        strategy: step.reason,
        query: step.query || describeToolFocus(step.tool, selectedStrategy),
        inputSummary: buildToolInputSummary(step, stockInfo, selectedStrategy, period, adjust),
        resultSummary: humanizeAgentError(error instanceof Error ? error.message : String(error)),
        startedAt,
        finishedAt: Date.now(),
        durationMs: Date.now() - startedAt,
      }
      trace.push(traceStep)
      emitProgress(traceStep)
    }
  }

  const technical = buildTechnicalSnapshot(klineData)
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
    ...stockNews.slice(0, 3).map((item) => ({ title: item.title, summary: item.summary || item.content || '', source: item.source, tone: 'neutral' as const })),
    ...macroNews.slice(0, 3).map((item) => ({ title: item.title, summary: item.summary || item.content || '', source: item.source, tone: isNegativeSignal(`${item.title} ${item.summary || item.content || ''}`) ? 'negative' as const : 'neutral' as const })),
    ...marketIndices.slice(0, 2).map((item) => ({
      title: `${item.name} 指数环境`,
      summary: `${item.name} 当前 ${item.price}，涨跌幅 ${item.changePercent}% ，可作为市场风险偏好参考。`,
      source: '市场指数',
      tone: item.changePercent >= 0 ? 'positive' as const : 'negative' as const,
    })),
    ...sectorRank.slice(0, 2).map((item) => ({
      title: `${item.name} 行业热度`,
      summary: `行业涨跌幅 ${item.changePercent}% ，领涨股 ${item.leadingStock || '待同步'}。`,
      source: '行业板块',
      tone: item.changePercent >= 0 ? 'positive' as const : 'negative' as const,
    })),
    ...conceptRank.slice(0, 2).map((item) => ({
      title: `${item.name} 概念热度`,
      summary: `概念涨跌幅 ${item.changePercent}% ，领涨股 ${item.leadingStock || '待同步'}。`,
      source: '概念板块',
      tone: item.changePercent >= 0 ? 'positive' as const : 'negative' as const,
    })),
    ...(fundFlow
      ? [{
          title: `${stockInfo.name} 主力资金`,
          summary: `主力净流入 ${fundFlow.mainNetInflow}，占比 ${fundFlow.mainNetInflowPercent}% 。`,
          source: '资金流',
          tone: fundFlow.mainNetInflow >= 0 ? 'positive' as const : 'negative' as const,
        }]
      : []),
    ...searchEvidence.slice(0, 4).map((item) => ({ title: item.title, summary: item.content, source: item.providerName || item.media || '外部搜索', tone: isNegativeSignal(`${item.title} ${item.content}`) ? 'negative' as const : 'neutral' as const })),
  ]

  const derivedNarratives = {
    catalysts: buildCatalystHints(stockInfo, stockNews, macroNews, searchEvidence, sectorRank, conceptRank, fundFlow, technical),
    risks: buildRiskHints(stockInfo, macroNews, searchEvidence, marketIndices, fundFlow, technical),
    impacts: buildImpactHints(macroNews, searchEvidence, marketIndices, sectorRank),
  }

  let diagnosis = buildFallbackDiagnosis(stockInfo, technical, trace, evidence, derivedNarratives, selectedStrategy)

  if (options.provider) {
    try {
      const synthesisStarted = Date.now()
      const synthesisId = `synthesis_${synthesisStarted}`
      emitProgress({
        id: synthesisId,
        kind: 'synthesis',
        title: '结论汇总',
        status: 'running',
        strategy: 'LLM Synthesis',
        inputSummary: selectedStrategy ? `按「${selectedStrategy.name}」综合结论。` : '按默认综合框架综合结论。',
        resultSummary: '正在汇总买卖区间、风险和催化...',
        query: '价格结构、资金变化、消息催化、行业板块与风险收益比',
        startedAt: synthesisStarted,
        finishedAt: synthesisStarted,
        durationMs: 0,
      })
      const raw = await chat(
        options.provider,
        [
          {
            role: 'system',
            content: '你是审慎的 A 股投研 Agent。你的证据只能来自输入里的内置股票模块结果与可选外部搜索结果，必须先回答用户问题里最关心的点，再给买卖区间、止损止盈和仓位建议。禁止承诺收益率或保证胜率。请严格输出 JSON。',
          },
          {
            role: 'user',
            content: JSON.stringify({
              questionContext: {
                originalQuestion: options.question || '',
                matchedKeyword: options.matchedKeyword || '',
                resolvedStockName: options.resolvedName || stockInfo.name,
                focus: questionFocus || '价格、资金、消息、板块、风险收益比',
                candidates: options.matchCandidates?.slice(0, 5) || [],
              },
              stock: {
                code: stockInfo.code,
                name: stockInfo.name,
                price: stockInfo.price,
                changePercent: stockInfo.changePercent,
                board: profile.board,
                limitUp: limitPrices.limitUp,
                limitDown: limitPrices.limitDown,
              },
              selectedStrategy: selectedStrategyContext,
              toolCatalog,
              finance,
              technical,
              marketIndices,
              orderBook: {
                bids: stockInfo.bids,
                asks: stockInfo.asks,
              },
              fundFlow,
              topSectors: sectorRank.slice(0, 8),
              topConcepts: conceptRank.slice(0, 8),
              stockNews: stockNews.slice(0, 6),
              macroNews: macroNews.slice(0, 6),
              externalSearch: searchEvidence,
              searchProviders: availableSearchProviders.map((item) => ({
                id: item.id,
                name: item.name,
                provider: item.provider,
              })),
              trace: trace.map((item) => ({
                tool: item.tool,
                status: item.status,
                input: item.inputSummary,
                summary: item.resultSummary,
              })),
              schema: {
                recommendation: 'string',
                prediction: 'string',
                confidence: '0-100',
                riskLevel: '低/中/高',
                summary: 'string',
                supportPrice: 'number',
                resistancePrice: 'number',
                buyLower: 'number',
                buyUpper: 'number',
                sellLower: 'number',
                sellUpper: 'number',
                positionAdvice: 'string',
                positionSize: 'string',
                entryAdvice: 'string',
                exitAdvice: 'string',
                stopLossPrice: 'number',
                takeProfitPrice: 'number',
                suggestedShares: 'number',
                catalysts: ['string'],
                risks: ['string'],
                socialSignals: ['string'],
                strategyFocus: ['string'],
                evidence: [{ title: 'string', summary: 'string', source: 'string', tone: 'positive|negative|neutral' }],
                scenarios: [{ label: '1日情景', expectedPrice: 0, probabilityHint: 'string' }],
              },
            }),
          },
        ],
        { temperature: 0.2, maxTokens: 2200 },
      )

      const parsed = parseJsonBlock<AiDiagnosis>(raw)
      diagnosis = sanitizeDiagnosis({
        ...diagnosis,
        ...parsed,
        strategyFocus: parsed.strategyFocus?.length ? parsed.strategyFocus : buildStrategyFocus(selectedStrategy, technical, evidence),
        evidence: parsed.evidence?.length ? parsed.evidence : diagnosis.evidence,
        toolCalls: trace,
        generatedAt: Date.now(),
        rawText: raw,
      }, stockInfo, technical, trace, evidence, derivedNarratives)
      const synthesisStep: DiagnosisAgentStep = {
        id: synthesisId,
        kind: 'synthesis',
        title: '结论汇总',
        status: 'done',
        strategy: 'LLM Synthesis',
        inputSummary: selectedStrategy ? `按「${selectedStrategy.name}」把价格、消息、资金和板块证据综合成结论。` : '按默认综合框架汇总结论。',
        resultSummary: `${diagnosis.recommendation} / ${diagnosis.prediction} / 置信 ${diagnosis.confidence}%`,
        query: '价格结构、资金变化、消息催化、行业板块与风险收益比',
        startedAt: synthesisStarted,
        finishedAt: Date.now(),
        durationMs: Date.now() - synthesisStarted,
      }
      trace.push(synthesisStep)
      emitProgress(synthesisStep)
    } catch (error) {
      const synthesisStep = createStep({
        kind: 'synthesis',
        title: '结论汇总',
        status: 'error',
        strategy: 'Fallback Synthesis',
        inputSummary: selectedStrategy ? `按「${selectedStrategy.name}」汇总结论。` : '按默认综合框架汇总结论。',
        resultSummary: humanizeAgentError(error instanceof Error ? error.message : String(error)),
        query: '价格结构、资金变化、消息催化、行业板块与风险收益比',
      })
      trace.push(synthesisStep)
      emitProgress(synthesisStep)
      diagnosis.toolCalls = trace
    }
  }

  diagnosis = sanitizeDiagnosis(diagnosis, stockInfo, technical, trace, evidence, derivedNarratives)

  return {
    stockInfo,
    finance,
    klineData,
    stockNews,
    macroNews,
    technical,
    diagnosis,
    trace,
    policyEvidence: diagnosis.evidence || evidence,
    selectedStrategy: selectedStrategyContext,
  }
}
