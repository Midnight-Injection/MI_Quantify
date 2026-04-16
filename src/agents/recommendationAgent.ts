import { runDiagnosisAgent } from '@/agents/diagnosisAgent'
import { useSidecar } from '@/composables/useSidecar'
import type { DiagnosisAgentStep, MarketIndex, NewsItem, SearchProvider, StockListItem, Strategy, AiProvider } from '@/types'
import type {
  RecommendationCandidate,
  RecommendationLaunchWindow,
  RecommendationMarket,
  RecommendationPreferences,
  RecommendationResult,
} from '@/types/recommendation'
import { buildTechnicalSnapshot } from '@/utils/marketMetrics'
import { buildRecommendationBasisSummary, getRecommendationMarketLabel } from '@/utils/recommendation'
import { normalizeSecurityCode } from '@/utils/security'

interface SearchResultItem {
  title: string
  content: string
  link: string
  media?: string
  providerName?: string
}

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function marketNewsKeywords(market: RecommendationMarket) {
  if (market === 'hk') return ['港股', '恒生科技', '中概', '南向资金', '人民币', '互联网', '业绩', '政策', '国际']
  if (market === 'us') return ['美股', '纳斯达克', 'AI', '美联储', '科技股', '财报', '国际', '地缘', '降息']
  return ['A股', '政策', '机器人', '算力', '消费', '券商', '财报', '资金面', '国际']
}

function normalizeSearchProviders(searchProviders?: SearchProvider[] | null, activeSearchProvider?: SearchProvider | null) {
  const seen = new Set<string>()
  return [...(searchProviders || [])]
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
}

function buildMarketSummary(indices: MarketIndex[], preferences: RecommendationPreferences) {
  if (!indices.length) {
    return `${getRecommendationMarketLabel(preferences.market)} 指数环境暂未同步，当前更多依赖个股走势、消息面和实时资金强弱来筛选。`
  }
  const lead = indices[0]
  const avgChange = average(indices.map((item) => Number(item.changePercent) || 0))
  const tone = avgChange >= 0.8 ? '整体偏强' : avgChange <= -0.8 ? '整体偏谨慎' : '分化震荡'
  return `${getRecommendationMarketLabel(preferences.market)} 当前以 ${lead.name}${lead.changePercent >= 0 ? ' +' : ' '}${lead.changePercent.toFixed(2)}% 为代表，指数环境${tone}。`
}

function buildSearchQuery(preferences: RecommendationPreferences) {
  const themeText = preferences.themes.length ? preferences.themes.join(' ') : marketNewsKeywords(preferences.market || 'a').join(' ')
  return `${getRecommendationMarketLabel(preferences.market)} ${themeText} 最新财报 政策 国际消息 资金面 板块轮动 催化 风险 热点`
}

function computePreScore(stock: StockListItem, preferences: RecommendationPreferences) {
  const change = Number(stock.changePercent) || 0
  const turnover = Number(stock.turnover) || 0
  const amount = Number(stock.amount) || 0
  const mv = Number(stock.totalMv) || 0
  let score = 50

  if (preferences.riskTolerance === 'high') {
    score += clamp(change * 3, -18, 18)
    score += clamp(turnover * 1.6, 0, 16)
  } else if (preferences.riskTolerance === 'low') {
    score += clamp(8 - Math.abs(change - 2), -6, 10)
    score += mv > 0 ? clamp(Math.log10(Math.max(mv, 1)) * 3, 0, 14) : 0
    score -= turnover > 10 ? 6 : 0
  } else {
    score += clamp(change * 2, -12, 14)
    score += clamp(turnover, 0, 12)
  }

  if (preferences.horizon === 'short') {
    score += change > 0 ? 6 : -4
    score += turnover > 4 ? 4 : 0
  } else if (preferences.horizon === 'mid') {
    score += change > -2 && change < 5 ? 6 : 0
    score += mv > 0 ? 4 : 0
  }

  const themeText = preferences.themes.join(' ')
  if (themeText && stock.name && themeText.toLowerCase().includes(stock.name.toLowerCase())) {
    score += 10
  }

  if (preferences.avoidThemes.some((theme) => stock.name.includes(theme))) {
    score -= 14
  }

  score += amount > 0 ? clamp(Math.log10(Math.max(amount, 1)), 0, 12) : 0
  return score
}

function buildShortlistReason(stock: StockListItem, preferences: RecommendationPreferences) {
  const reasons: string[] = []
  if ((stock.changePercent || 0) > 0) reasons.push(`当日强度 ${stock.changePercent.toFixed(2)}%`)
  if ((stock.turnover || 0) > 0) reasons.push(`换手 ${stock.turnover.toFixed(2)}%`)
  if (preferences.riskTolerance === 'low' && stock.totalMv) reasons.push('体量相对更稳')
  if (preferences.horizon === 'short' && (stock.turnover || 0) > 4) reasons.push('短线活跃度较高')
  return reasons.slice(0, 3).join('，') || '纳入当前市场活跃候选池'
}

function resolveLaunchWindow(result: Awaited<ReturnType<typeof runDiagnosisAgent>>): RecommendationLaunchWindow {
  const technical = result.technical
  const catalysts = result.diagnosis.catalysts || []

  if (technical.trend === 'bullish' && technical.momentum === 'strong' && result.stockInfo.price < technical.resistancePrice * 0.99) {
    return {
      label: '1-3个交易日',
      reason: '价格仍贴近突破位，量能与动量同步偏强，短线更容易在临近几个交易日触发。',
    }
  }

  if ((technical.trend === 'bullish' || technical.momentum === 'moderate') && catalysts.length) {
    return {
      label: '1-2周',
      reason: '技术结构尚可，且当前已有消息催化，需要等待板块或资金继续确认。',
    }
  }

  return {
    label: '中线待观察',
    reason: '当前更像观察阶段，K线结构和催化仍不足以支持更快启动判断。',
  }
}

function buildCandidate(
  rank: number,
  preScore: number,
  shortlistReason: string,
  result: Awaited<ReturnType<typeof runDiagnosisAgent>>,
): RecommendationCandidate {
  const technical = buildTechnicalSnapshot(result.klineData)
  const launchWindow = resolveLaunchWindow(result)
  const whySelected = [
    shortlistReason,
    ...(result.diagnosis.catalysts || []).slice(0, 2),
  ].filter(Boolean)
  const watchPoints = [
    result.diagnosis.entryAdvice || '',
    result.diagnosis.exitAdvice || '',
    launchWindow.reason,
  ].filter(Boolean)
  const score = Math.round(preScore * 0.4 + (result.diagnosis.confidence || 0) * 0.6 + (technical.trend === 'bullish' ? 6 : 0))

  return {
    rank,
    code: result.stockInfo.code,
    name: result.stockInfo.name,
    market: result.stockInfo.code.length === 5 ? 'hk' : /^[A-Z]/.test(result.stockInfo.code) ? 'us' : 'a',
    score,
    summary: result.diagnosis.summary,
    shortlistReason,
    whySelected,
    watchPoints: watchPoints.slice(0, 3),
    launchWindow,
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

function buildDiagnosisQuestion(preferences: RecommendationPreferences, stock: StockListItem) {
  const segments = [
    `请从${getRecommendationMarketLabel(preferences.market)}里研究这只股票是否适合作为当前候选`,
    preferences.horizon ? `目标周期是${preferences.horizon === 'short' ? '短线' : preferences.horizon === 'swing' ? '1-2周波段' : '中线'}` : '',
    preferences.riskTolerance ? `风险偏好偏${preferences.riskTolerance === 'low' ? '稳健' : preferences.riskTolerance === 'medium' ? '均衡' : '激进'}` : '',
    preferences.themes.length ? `重点关注${preferences.themes.join('、')}` : '',
    preferences.avoidThemes.length ? `回避${preferences.avoidThemes.join('、')}` : '',
    `候选股票：${stock.name} ${stock.code}`,
  ]
  return segments.filter(Boolean).join('，')
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
  const { get, post } = useSidecar()
  const preferences = options.preferences
  const market = preferences.market || 'a'
  const searchProviders = normalizeSearchProviders(options.searchProviders, options.activeSearchProvider)
  throwIfAborted(options.abortSignal)

  const [indicesRes, stockListRes, newsRes, sectorRes, searchRes] = await withAbort(Promise.all([
    get<{ data: MarketIndex[] }>(`/api/market/indices?market=${market}`),
    get<{ data: StockListItem[]; total: number }>(`/api/market/stocks?market=${market}&page=1&pageSize=${market === 'a' ? 160 : 96}`),
    get<{ data: NewsItem[] }>('/api/news/financial?limit=80'),
    market === 'a' ? get<{ data: Array<{ name: string; changePercent: number; leadingStock: string }> }>('/api/sector/industry') : Promise.resolve({ data: [] }),
    searchProviders.length
      ? post<{ data: SearchResultItem[] }>('/api/news/search', {
        query: buildSearchQuery(preferences),
        limit: 20,
        providers: searchProviders.map((provider) => ({
          id: provider.id,
          name: provider.name,
          provider: provider.provider,
          apiUrl: provider.apiUrl,
          apiKey: provider.apiKey,
          enabled: provider.enabled,
        })),
      })
      : Promise.resolve({ data: [] }),
  ]), options.abortSignal)

  const stockUniverse = (stockListRes.data || [])
    .filter((item) => !preferences.mustExclude.includes(item.code))
    .filter((item) => !preferences.mustExclude.includes(item.name))

  const rankedUniverse = stockUniverse
    .map((stock) => ({
      stock,
      preScore: computePreScore(stock, preferences),
      shortlistReason: buildShortlistReason(stock, preferences),
    }))
    .sort((a, b) => b.preScore - a.preScore)

  const shortlist = rankedUniverse.slice(0, 12)
  const researchTargets = shortlist.slice(0, 5)
  const diagnosisResults = await Promise.all(
    researchTargets.map(async (item) => {
      throwIfAborted(options.abortSignal)
      const result = await runDiagnosisAgent({
        code: normalizeSecurityCode(item.stock.code),
        provider: options.provider,
        searchProviders: options.searchProviders,
        activeSearchProvider: options.activeSearchProvider,
        selectedStrategy: options.selectedStrategy,
        question: buildDiagnosisQuestion(preferences, item.stock),
        resolvedName: item.stock.name,
        matchedKeyword: item.stock.name,
        maxSteps: options.maxSteps ?? (market === 'a' ? 14 : 12),
        onProgress: (event) => options.onProgress?.(event.step),
        abortSignal: options.abortSignal,
      })
      return buildCandidate(0, item.preScore, item.shortlistReason, result)
    }),
  )

  const candidates = diagnosisResults
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((item, index) => ({ ...item, rank: index + 1 }))

  const basisSummary = buildRecommendationBasisSummary(preferences)
  const searchHighlights = (searchRes.data || []).slice(0, 4).map((item) => `${item.providerName || item.media || '外部搜索'}：${item.title}`)
  const sectorHighlights = (sectorRes.data || []).slice(0, 3).map((item) => `行业热度：${item.name} ${item.changePercent >= 0 ? '+' : ''}${item.changePercent}%`)
  const newsHighlights = (newsRes.data || []).slice(0, 4).map((item) => `消息面：${item.title}`)

  return {
    preferences,
    basisSummary: [
      ...basisSummary,
      buildMarketSummary(indicesRes.data || [], preferences),
      ...newsHighlights,
      ...sectorHighlights,
      ...searchHighlights,
    ].slice(0, 10),
    marketSummary: buildMarketSummary(indicesRes.data || [], preferences),
    shortlistCount: shortlist.length,
    candidates,
    disclaimer: '以下为研究候选清单，不构成投资建议，请结合仓位与风控独立判断。',
    generatedAt: Date.now(),
  }
}
