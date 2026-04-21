export function formatPrice(price: number): string {
  return price.toFixed(2)
}

export function formatChange(change: number): string {
  const sign = change > 0 ? '+' : ''
  return `${sign}${change.toFixed(2)}`
}

export function formatPercent(percent: number): string {
  const sign = percent > 0 ? '+' : ''
  return `${sign}${percent.toFixed(2)}`
}

export function formatVolume(volume: number): string {
  if (volume >= 100_000_000) return `${(volume / 100_000_000).toFixed(2)}亿`
  if (volume >= 10_000) return `${(volume / 10_000).toFixed(2)}万`
  return volume.toFixed(0)
}

/**
 * 去掉小数末尾多余的 0，避免大金额显示过长
 * @param value - 已格式化的小数字符串
 * @returns 去掉冗余 0 后的字符串
 */
function trimTrailingZeros(value: string): string {
  return value.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1')
}

/**
 * 格式化金额，超过万亿时压缩为“万亿”单位
 * @param amount - 原始金额数值，单位为元
 * @returns 可读金额字符串，如 "2.4万亿" / "3184.91亿"
 */
export function formatAmount(amount: number): string {
  const absAmount = Math.abs(amount)
  const sign = amount < 0 ? '-' : ''
  if (absAmount >= 1_000_000_000_000) return `${sign}${trimTrailingZeros((absAmount / 1_000_000_000_000).toFixed(2))}万亿`
  if (absAmount >= 100_000_000) return `${sign}${trimTrailingZeros((absAmount / 100_000_000).toFixed(2))}亿`
  if (absAmount >= 10_000) return `${sign}${trimTrailingZeros((absAmount / 10_000).toFixed(2))}万`
  return amount.toFixed(0)
}

export interface TurnoverPulseDisplay {
  compact: string
  full: string
  compressed: boolean
}

/**
 * 将首页成交脉冲的“亿”单位数值统一解析为数字，兼容“25786亿/2.5万亿/25786”三种格式
 * @param value - 首页卡片里的成交额文本或数值，单位默认为亿
 * @returns 解析后的“亿”单位数值
 */
function normalizeTurnoverYi(value: number | string): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  const raw = `${value || ''}`.replace(/,/g, '').trim()
  if (!raw) return 0

  const trillionMatch = raw.match(/(-?\d+(?:\.\d+)?)\s*万亿/)
  if (trillionMatch) {
    return Number(trillionMatch[1]) * 10_000
  }

  const yiMatch = raw.match(/(-?\d+(?:\.\d+)?)\s*亿/)
  if (yiMatch) {
    return Number(yiMatch[1])
  }

  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : 0
}

/**
 * 格式化首页成交脉冲展示，大于万亿时显示主值+缩小完整值
 * @param value - 以“亿”为单位的成交额
 * @returns 主显示值与完整值
 */
export function formatTurnoverPulse(value: number | string): TurnoverPulseDisplay {
  const amountYi = normalizeTurnoverYi(value)
  const sign = amountYi < 0 ? '-' : ''
  const absAmountYi = Math.abs(amountYi)
  const full = `${sign}${Math.round(absAmountYi).toLocaleString('zh-CN')}亿`
  if (absAmountYi >= 10_000) {
    return {
      compact: `${sign}${trimTrailingZeros((absAmountYi / 10_000).toFixed(1))}万亿`,
      full,
      compressed: true,
    }
  }
  return {
    compact: full,
    full: '',
    compressed: false,
  }
}

export function formatTime(timestamp: number): string {
  const d = new Date(timestamp)
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

export function formatDate(timestamp: number): string {
  const d = new Date(timestamp)
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function formatDateTime(timestamp: number): string {
  return `${formatDate(timestamp)} ${formatTime(timestamp)}`
}
