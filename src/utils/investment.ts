import type {
  InvestmentContributionMode,
  InvestmentLiquidityNeed,
  InvestmentPreferences,
  InvestmentRisk,
} from '@/types'

function unique(values: string[]) {
  return values.filter((value, index) => value && values.indexOf(value) === index)
}

function parseChineseNumber(value: string) {
  const normalized = value.replace(/[,，\s]/g, '').trim()
  if (!normalized) return undefined
  const amount = Number.parseFloat(normalized)
  if (!Number.isFinite(amount)) return undefined
  return amount
}

function parseAmount(message: string) {
  const wan = message.match(/([0-9]+(?:\.[0-9]+)?)\s*万/)
  if (wan) {
    const amount = parseChineseNumber(wan[1])
    return typeof amount === 'number' ? amount * 10000 : undefined
  }

  const yuan = message.match(/([0-9]+(?:\.[0-9]+)?)\s*(?:元|块|人民币)?/)
  if (!yuan) return undefined
  const amount = parseChineseNumber(yuan[1])
  return typeof amount === 'number' && amount >= 100 ? amount : undefined
}

function parseTermMonths(message: string) {
  const monthMatch = message.match(/([0-9]+)\s*个?月/)
  if (monthMatch) return Number.parseInt(monthMatch[1], 10)

  const quarterMatch = message.match(/([0-9]+)\s*个?季度/)
  if (quarterMatch) return Number.parseInt(quarterMatch[1], 10) * 3

  if (/三个月|3个月/.test(message)) return 3
  if (/半年|六个月|6个月/.test(message)) return 6
  if (/一年|12个月|1年/.test(message)) return 12
  return undefined
}

function parseBank(message: string) {
  if (/(中国银行|中行|BOC)/i.test(message)) return '中国银行'
  if (/(工商银行|工行|ICBC)/i.test(message)) return '工商银行'
  if (/(建设银行|建行|CCB)/i.test(message)) return '建设银行'
  if (/(农业银行|农行|ABC)/i.test(message)) return '农业银行'
  if (/(招商银行|招行|CMB)/i.test(message)) return '招商银行'
  return undefined
}

function parseContributionMode(message: string): InvestmentContributionMode | undefined {
  if (/(定投|每月|月投)/.test(message)) return 'monthly_sip'
  if (/(一次性|一笔|先投|现有资金|闲钱)/.test(message)) return 'lump_sum'
  return undefined
}

function parseMonthlyAmount(message: string) {
  const monthly = message.match(/每月(?:投|定投|投入)?\s*([0-9]+(?:\.[0-9]+)?)\s*(万|元|块)?/)
  if (!monthly) return undefined
  const amount = parseChineseNumber(monthly[1])
  if (typeof amount !== 'number') return undefined
  return monthly[2] === '万' ? amount * 10000 : amount
}

function parseRisk(message: string): InvestmentRisk | undefined {
  if (/(保守|稳健|低风险|保本)/.test(message)) return 'low'
  if (/(均衡|中风险|平衡)/.test(message)) return 'medium'
  if (/(激进|高风险|高收益|更高收益)/.test(message)) return 'high'
  return undefined
}

function parseLiquidity(message: string): InvestmentLiquidityNeed | undefined {
  if (/(随时要用|灵活|流动性高|可随取|短期要用钱)/.test(message)) return 'high'
  if (/(能锁定|不急用|可接受锁定)/.test(message)) return 'low'
  if (/(兼顾流动性|一般流动性)/.test(message)) return 'medium'
  return undefined
}

function parseAllowedProducts(message: string) {
  const values: string[] = []
  if (/基金/.test(message)) values.push('基金')
  if (/存款|定期|存单/.test(message)) values.push('存款')
  if (/理财/.test(message)) values.push('理财')
  return unique(values)
}

function parseForbiddenProducts(message: string) {
  const values: string[] = []
  if (/(不要基金|不买基金|排除基金)/.test(message)) values.push('基金')
  if (/(不要存款|不考虑存款|排除存款)/.test(message)) values.push('存款')
  if (/(不要理财|不考虑理财|排除理财)/.test(message)) values.push('理财')
  return unique(values)
}

export function buildEmptyInvestmentPreferences(): InvestmentPreferences {
  return {
    allowedProducts: [],
    forbiddenProducts: [],
    originalPrompt: '',
  }
}

export function parseInvestmentPreferences(
  message: string,
  existing?: InvestmentPreferences | null,
): InvestmentPreferences {
  const next: InvestmentPreferences = {
    ...(existing || buildEmptyInvestmentPreferences()),
    allowedProducts: [...(existing?.allowedProducts || [])],
    forbiddenProducts: [...(existing?.forbiddenProducts || [])],
    originalPrompt: existing?.originalPrompt || message,
    lastUserMessage: message,
  }

  next.bank = parseBank(message) || next.bank
  next.principal = parseAmount(message) || next.principal
  next.termMonths = parseTermMonths(message) || next.termMonths
  next.contributionMode = parseContributionMode(message) || next.contributionMode || 'lump_sum'
  next.monthlyAmount = parseMonthlyAmount(message) || next.monthlyAmount
  next.riskTolerance = parseRisk(message) || next.riskTolerance
  next.liquidityNeed = parseLiquidity(message) || next.liquidityNeed
  next.allowedProducts = unique([...next.allowedProducts, ...parseAllowedProducts(message)])
  next.forbiddenProducts = unique([...next.forbiddenProducts, ...parseForbiddenProducts(message)])

  if (next.contributionMode === 'monthly_sip' && !next.monthlyAmount && next.principal && next.termMonths) {
    next.monthlyAmount = Math.round(next.principal / next.termMonths)
  }

  return next
}

export function buildInvestmentBasisSummary(preferences: InvestmentPreferences) {
  return unique([
    preferences.bank ? `银行：${preferences.bank}` : '',
    typeof preferences.principal === 'number' ? `资金：${preferences.principal.toLocaleString('zh-CN')} 元` : '',
    preferences.termMonths ? `期限：${preferences.termMonths} 个月` : '',
    preferences.contributionMode === 'monthly_sip' ? '方式：按月定投' : '方式：一次性投入',
    preferences.riskTolerance === 'low'
      ? '风险偏好：稳健'
      : preferences.riskTolerance === 'high'
        ? '风险偏好：进取'
        : preferences.riskTolerance === 'medium'
          ? '风险偏好：均衡'
          : '',
    preferences.liquidityNeed === 'high'
      ? '流动性：高'
      : preferences.liquidityNeed === 'low'
        ? '流动性：可锁定'
        : preferences.liquidityNeed === 'medium'
          ? '流动性：中等'
          : '',
    preferences.allowedProducts.length ? `限定：${preferences.allowedProducts.join('、')}` : '',
    preferences.forbiddenProducts.length ? `排除：${preferences.forbiddenProducts.join('、')}` : '',
  ])
}
