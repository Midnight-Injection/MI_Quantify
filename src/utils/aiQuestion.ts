import type { DiagnosisAgentResult } from '@/agents/diagnosisAgent'
import type { StockQuote, StockSearchFn } from '@/types'
import { formatPrice } from '@/utils/format'
import { normalizeSecurityCode } from '@/utils/security'

interface LocalStockLike {
  code: string
  name: string
}

export interface ResolvedStockCandidate {
  code: string
  name: string
}

export interface ResolvedStockMatch {
  code: string
  name: string
  keyword: string
  confidence: number
  matchMode: 'direct_code' | 'name_exact' | 'name_prefix' | 'name_contains' | 'code_contains' | 'fuzzy'
  candidates: ResolvedStockCandidate[]
}

interface RankedCandidate extends ResolvedStockCandidate {
  score: number
  matchMode: ResolvedStockMatch['matchMode']
}

function normalizeSearchText(input: string) {
  return input
    .trim()
    .toLowerCase()
    .replace(/[\s"'`~!@#$%^&*()_+\-=[\]{};:,.<>/?\\|，。！？、；：“”‘’（）【】《》]/g, '')
}

function extractDirectCode(input: string) {
  const prefixed = input.match(/\b(?:sh|sz|bj|hk|us)\d{5,6}\b/i)?.[0]
  if (prefixed) return normalizeSecurityCode(prefixed)

  const digits = input.match(/\b\d{5,6}\b/)?.[0]
  if (digits) return normalizeSecurityCode(digits)

  const alpha = input.trim().match(/^(?:us)?[A-Za-z]{1,5}$/)?.[0]
  if (alpha) return normalizeSecurityCode(alpha)

  return ''
}

function dedupeCandidates(remote: StockQuote[], localStocks: LocalStockLike[]) {
  const merged = new Map<string, ResolvedStockCandidate>()

  for (const item of remote) {
    const code = normalizeSecurityCode(item.code)
    if (!code) continue
    merged.set(code, { code, name: item.name || code })
  }

  for (const item of localStocks) {
    const code = normalizeSecurityCode(item.code)
    if (!code || merged.has(code)) continue
    merged.set(code, { code, name: item.name || code })
  }

  return Array.from(merged.values())
}

function rankCandidate(candidate: ResolvedStockCandidate, keyword: string) {
  const normalizedKeyword = normalizeSearchText(keyword)
  const normalizedName = normalizeSearchText(candidate.name)
  const normalizedCode = normalizeSecurityCode(candidate.code).toLowerCase()

  if (!normalizedKeyword) return null

  if (normalizedCode === normalizedKeyword.toLowerCase()) {
    return { ...candidate, score: 150, matchMode: 'direct_code' as const }
  }

  if (normalizedName && normalizedName === normalizedKeyword) {
    return { ...candidate, score: 136, matchMode: 'name_exact' as const }
  }

  if (normalizedName && normalizedName.startsWith(normalizedKeyword)) {
    return { ...candidate, score: 122 - Math.min(18, Math.max(0, normalizedName.length - normalizedKeyword.length)), matchMode: 'name_prefix' as const }
  }

  if (normalizedName && normalizedName.includes(normalizedKeyword)) {
    return { ...candidate, score: 112 - Math.min(24, normalizedName.indexOf(normalizedKeyword) * 2), matchMode: 'name_contains' as const }
  }

  if (normalizedCode.includes(normalizedKeyword.toLowerCase())) {
    return { ...candidate, score: 98, matchMode: 'code_contains' as const }
  }

  if (normalizedName && normalizedKeyword.length >= 2 && normalizedKeyword.includes(normalizedName)) {
    return { ...candidate, score: 92, matchMode: 'fuzzy' as const }
  }

  return null
}

function buildQuestionKeywords(question: string) {
  const compact = question.replace(/[？?。！，,、；;：:\s（）()【】《》"'`]/g, '')
  const stripped = compact
    .replace(/请按[\u4e00-\u9fa5A-Za-z0-9_-]{2,20}策略(评估|分析|研究|诊断)?/g, '')
    .replace(/按[\u4e00-\u9fa5A-Za-z0-9_-]{2,20}策略(评估|分析|研究|诊断)?/g, '')
    .replace(/^(请问|想问|帮我|请帮我|麻烦|看看|再看下|分析一下|分析|诊断一下|诊断|研究一下|研究|评估一下|评估)/g, '')
    .replace(/(股票|个股|问股|行情|走势|情况|表现|估值|基本面|技术面|题材|逻辑|可不可以|值不值得|怎么了|怎么样|怎么看|如何|适合|要不要|参与|介入|上车|下车|布局|持有|继续|追吗|追高|低吸|能买吗|买入吗|卖出吗|买入|卖出|现在|目前|今日|最近|吗|呢|呀|吧)+$/g, '')

  const chineseSegments = stripped.match(/[\u4e00-\u9fa5]{2,12}/g) || []
  const alphaSegments = question.match(/[A-Za-z]{2,6}/g) || []
  const digitSegments = question.match(/\d{5,6}/g) || []

  return [stripped, compact, ...chineseSegments, ...alphaSegments, ...digitSegments]
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item, index, list) => list.indexOf(item) === index)
    .slice(0, 6)
}

async function resolveByKeyword(
  keyword: string,
  searchStock: StockSearchFn,
  localStocks: LocalStockLike[] = [],
): Promise<ResolvedStockMatch | null> {
  const directCode = extractDirectCode(keyword)
  if (directCode) {
    const remote = await searchStock(directCode)
    const local = localStocks.find((item) => normalizeSecurityCode(item.code) === directCode)
    const candidates = dedupeCandidates(remote, local ? [local] : []).slice(0, 5)
    return {
      code: directCode,
      name: remote[0]?.name || local?.name || directCode,
      keyword,
      confidence: 150,
      matchMode: 'direct_code',
      candidates: candidates.length ? candidates : [{ code: directCode, name: remote[0]?.name || local?.name || directCode }],
    }
  }

  const remote = await searchStock(keyword)
  const normalizedKeyword = normalizeSearchText(keyword)
  const localCandidates = localStocks.filter((item) => {
    const code = normalizeSecurityCode(item.code).toLowerCase()
    const name = normalizeSearchText(item.name)
    return code.includes(normalizedKeyword) || name.includes(normalizedKeyword) || (name ? normalizedKeyword.includes(name) : false)
  })
  const ranked = dedupeCandidates(remote, localCandidates)
    .map((candidate) => rankCandidate(candidate, keyword))
    .filter((candidate): candidate is RankedCandidate => !!candidate)
    .sort((a, b) => b.score - a.score || a.name.length - b.name.length)

  if (!ranked.length) return null

  const best = ranked[0]
  return {
    code: best.code,
    name: best.name,
    keyword,
    confidence: best.score,
    matchMode: best.matchMode,
    candidates: ranked.slice(0, 5).map(({ code, name }) => ({ code, name })),
  }
}

export async function resolveStockFromInput(
  input: string,
  searchStock: StockSearchFn,
  localStocks: LocalStockLike[] = [],
) {
  const keyword = input.trim()
  if (!keyword) return null
  return resolveByKeyword(keyword, searchStock, localStocks)
}

export async function resolveStockCodeFromInput(
  input: string,
  searchStock: StockSearchFn,
  localStocks: LocalStockLike[] = [],
) {
  const resolved = await resolveStockFromInput(input, searchStock, localStocks)
  return resolved?.code || ''
}

export async function resolveStockFromQuestion(
  question: string,
  searchStock: StockSearchFn,
  localStocks: LocalStockLike[] = [],
) {
  const directCode = extractDirectCode(question)
  if (directCode) {
    return resolveByKeyword(directCode, searchStock, localStocks)
  }

  const keywords = buildQuestionKeywords(question)
  let bestMatch: ResolvedStockMatch | null = null

  for (const keyword of keywords) {
    const resolved = await resolveByKeyword(keyword, searchStock, localStocks)
    if (!resolved) continue
    if (!bestMatch || resolved.confidence > bestMatch.confidence) {
      bestMatch = resolved
    }
  }

  return bestMatch
}

export async function resolveStockCodeFromQuestion(
  question: string,
  searchStock: StockSearchFn,
  localStocks: LocalStockLike[] = [],
) {
  const resolved = await resolveStockFromQuestion(question, searchStock, localStocks)
  return resolved?.code || ''
}

export function buildDiagnosisReply(result: DiagnosisAgentResult, resolved?: Pick<ResolvedStockMatch, 'keyword' | 'name'> | null) {
  const analysis = result.diagnosis
  const buyRange = typeof analysis.buyLower === 'number' && typeof analysis.buyUpper === 'number'
    ? `${formatPrice(analysis.buyLower)} - ${formatPrice(analysis.buyUpper)}`
    : '等待更清晰回踩'
  const sellRange = typeof analysis.sellLower === 'number' && typeof analysis.sellUpper === 'number'
    ? `${formatPrice(analysis.sellLower)} - ${formatPrice(analysis.sellUpper)}`
    : '等待趋势延续后再评估'
  const matchedLabel = resolved?.keyword?.trim()
  const matchLine = matchedLabel
    ? `已按“${matchedLabel}”自动匹配到 ${result.stockInfo.name}（${result.stockInfo.code}），并调用内置行情、K线、资讯、资金和板块工具完成研究。`
    : `已锁定 ${result.stockInfo.name}（${result.stockInfo.code}），并调用内置行情、K线、资讯、资金和板块工具完成研究。`
  const modelLine = result.llmSummary.fallback
    ? `模型状态：${result.llmSummary.notice}`
    : `模型状态：${result.llmSummary.notice}`

  return [
    matchLine,
    modelLine,
    `${result.stockInfo.name}（${result.stockInfo.code}）当前研究结论：${analysis.recommendation}。`,
    analysis.summary,
    `评估方式：${result.selectedStrategy?.name || '默认综合框架'}`,
    `研究框架：${analysis.strategyFocus?.join(' / ') || '价格、消息、资金、趋势四类交叉验证'}`,
    `建议买入区间：${buyRange}`,
    `建议卖出区间：${sellRange}`,
    `止损 / 止盈参考：${typeof analysis.stopLossPrice === 'number' ? formatPrice(analysis.stopLossPrice) : '--'} / ${typeof analysis.takeProfitPrice === 'number' ? formatPrice(analysis.takeProfitPrice) : '--'}`,
    `主要催化：${analysis.catalysts?.join('、') || '等待更多证据'}`,
    `主要风险：${analysis.risks?.join('、') || '等待更多证据'}`,
  ].join('\n')
}
