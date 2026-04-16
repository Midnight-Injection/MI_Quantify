import type {
  RecommendationClarifyField,
  RecommendationClarifyQuestion,
  RecommendationEntryStyle,
  RecommendationHorizon,
  RecommendationMarket,
  RecommendationPreferences,
  RecommendationRisk,
} from '@/types/recommendation'

const THEME_KEYWORDS = [
  'AI',
  '算力',
  '芯片',
  '半导体',
  '机器人',
  '汽车',
  '新能源',
  '电池',
  '军工',
  '医药',
  '创新药',
  '消费',
  '白酒',
  '券商',
  '银行',
  '黄金',
  '石油',
  '航运',
  '红利',
  '科技',
  '游戏',
  '云计算',
  '软件',
  '苹果链',
  '特斯拉',
]

const MARKET_LABELS: Record<RecommendationMarket, string> = {
  a: 'A股',
  hk: '港股',
  us: '美股',
}

const HORIZON_LABELS: Record<RecommendationHorizon, string> = {
  short: '短线',
  swing: '1-2周波段',
  mid: '中线',
}

const RISK_LABELS: Record<RecommendationRisk, string> = {
  low: '稳健',
  medium: '均衡',
  high: '激进',
}

function unique(values: string[]) {
  return values.filter((value, index) => value && values.indexOf(value) === index)
}

function normalizeTheme(theme: string) {
  return theme.replace(/[，,。；;、\s]/g, '').trim()
}

function extractThemes(input: string, negative = false) {
  const matches: string[] = []
  const normalized = input.replace(/\s+/g, '')
  for (const keyword of THEME_KEYWORDS) {
    const hasKeyword = normalized.toLowerCase().includes(keyword.toLowerCase())
    if (!hasKeyword) continue
    const context = negative
      ? new RegExp(`(?:不要|别碰|避开|排除|不看|剔除)[^，。；;、]{0,12}${keyword}`, 'i')
      : new RegExp(`${keyword}`, 'i')
    if (context.test(normalized)) {
      matches.push(keyword)
    }
  }
  return unique(matches.map(normalizeTheme))
}

export function buildEmptyRecommendationPreferences(): RecommendationPreferences {
  return {
    themes: [],
    avoidThemes: [],
    mustInclude: [],
    mustExclude: [],
    originalPrompt: '',
  }
}

export function parseRecommendationPreferences(
  message: string,
  existing?: RecommendationPreferences | null,
): RecommendationPreferences {
  const next: RecommendationPreferences = {
    ...(existing || buildEmptyRecommendationPreferences()),
    themes: [...(existing?.themes || [])],
    avoidThemes: [...(existing?.avoidThemes || [])],
    mustInclude: [...(existing?.mustInclude || [])],
    mustExclude: [...(existing?.mustExclude || [])],
    originalPrompt: existing?.originalPrompt || message,
    lastUserMessage: message,
  }

  if (/(A股|沪深|创业板|科创板|北交所)/i.test(message)) next.market = 'a'
  if (/(港股|香港|恒生|H股|\bhk\b)/i.test(message)) next.market = 'hk'
  if (/(美股|纳指|纳斯达克|道琼斯|标普|华尔街|\bus\b|NASDAQ|NYSE)/i.test(message)) next.market = 'us'

  if (/(短线|打板|快进快出|1[-到至~ ]?3天|3日内|一周内|本周)/.test(message)) next.horizon = 'short'
  else if (/(波段|1[-到至~ ]?2周|两周|2周内|一到两周|短中线)/.test(message)) next.horizon = 'swing'
  else if (/(中线|一个月|1[-到至~ ]?3月|季度|趋势持有)/.test(message)) next.horizon = 'mid'

  if (/(稳健|保守|低风险|防守|蓝筹|少回撤)/.test(message)) next.riskTolerance = 'low'
  else if (/(均衡|平衡|中风险|一般风险)/.test(message)) next.riskTolerance = 'medium'
  else if (/(激进|高风险|高弹性|高波动|题材|进攻)/.test(message)) next.riskTolerance = 'high'

  if (/(突破|追强|右侧|顺势)/.test(message)) next.entryStyle = 'breakout'
  else if (/(低吸|回踩|回调|埋伏|左侧)/.test(message)) next.entryStyle = 'pullback'
  else if (!next.entryStyle) next.entryStyle = 'balanced'

  next.themes = unique([...next.themes, ...extractThemes(message, false)])
  next.avoidThemes = unique([...next.avoidThemes, ...extractThemes(message, true)])

  return next
}

export function recommendationNeedsClarification(preferences: RecommendationPreferences) {
  return !preferences.market || !preferences.horizon || !preferences.riskTolerance
}

export function buildRecommendationClarifyQuestion(
  preferences: RecommendationPreferences,
): RecommendationClarifyQuestion | null {
  const missingOrder: RecommendationClarifyField[] = ['market', 'horizon', 'riskTolerance']
  const missing = missingOrder.find((field) => !preferences[field])
  if (!missing) return null

  if (missing === 'market') {
    return {
      field: 'market',
      title: '先确认市场',
      prompt: '这轮你想让我筛哪个市场？我会按对应市场的消息面、K线和热点去找候选。',
      options: ['A股', '港股', '美股'],
    }
  }

  if (missing === 'horizon') {
    return {
      field: 'horizon',
      title: '再确认周期',
      prompt: '你想看多长周期的机会？这会直接影响我对“多久可能启动”的判断。',
      options: ['短线', '1-2周波段', '中线'],
    }
  }

  return {
    field: 'riskTolerance',
    title: '最后确认风险偏好',
    prompt: '你的风险偏好是哪种？我会据此平衡强势股、稳健股和回撤要求。',
    options: ['稳健', '均衡', '激进'],
  }
}

export function getRecommendationMarketLabel(market?: RecommendationMarket) {
  return market ? MARKET_LABELS[market] : '未指定市场'
}

export function getRecommendationHorizonLabel(horizon?: RecommendationHorizon) {
  return horizon ? HORIZON_LABELS[horizon] : '未指定周期'
}

export function getRecommendationRiskLabel(risk?: RecommendationRisk) {
  return risk ? RISK_LABELS[risk] : '未指定风险'
}

export function buildRecommendationBasisSummary(preferences: RecommendationPreferences) {
  return unique([
    `市场：${getRecommendationMarketLabel(preferences.market)}`,
    `周期：${getRecommendationHorizonLabel(preferences.horizon)}`,
    `风险偏好：${getRecommendationRiskLabel(preferences.riskTolerance)}`,
    preferences.entryStyle === 'breakout'
      ? '偏好：右侧突破'
      : preferences.entryStyle === 'pullback'
        ? '偏好：回踩低吸'
        : '偏好：均衡筛选',
    preferences.themes.length ? `关注主题：${preferences.themes.join('、')}` : '',
    preferences.avoidThemes.length ? `回避主题：${preferences.avoidThemes.join('、')}` : '',
  ])
}

export function looksLikeRecommendationRequest(message: string) {
  const trimmed = message.trim()
  if (!trimmed) return true
  return /(荐股|推荐.*股|帮我找|给我找|筛股|选股|机会|候选|买什么|看什么|布局什么|找.*机会|有什么股)/.test(trimmed)
}

export function marketQuickPrompts() {
  return [
    'A股短线机会',
    '港股科技股机会',
    '美股成长股机会',
    '无偏好直接筛选',
  ]
}

export function getEntryStyleLabel(entryStyle?: RecommendationEntryStyle) {
  if (entryStyle === 'breakout') return '突破跟随'
  if (entryStyle === 'pullback') return '回踩低吸'
  return '均衡筛选'
}
