import type { KlineData, StockProfile, TechnicalSnapshot } from '@/types'

function round(value: number, digits = 2) {
  if (!Number.isFinite(value)) return 0
  return Number(value.toFixed(digits))
}

function average(values: number[]) {
  if (!values.length) return 0
  return values.reduce((sum, item) => sum + item, 0) / values.length
}

function ema(values: number[], period: number) {
  if (!values.length) return []
  const multiplier = 2 / (period + 1)
  const result: number[] = [values[0]]
  for (let i = 1; i < values.length; i += 1) {
    result.push(values[i] * multiplier + result[i - 1] * (1 - multiplier))
  }
  return result
}

export function getStockProfile(code: string): StockProfile {
  const raw = String(code || '').trim().toUpperCase()

  if (/^[A-Z][A-Z0-9.\-]*$/.test(raw)) {
    return { market: 'us', board: '美股', lotSize: 1, currency: 'USD', priceLimitRatio: 0, tags: ['海外', 'T+0'] }
  }
  if (/^\d{5}$/.test(raw)) {
    return { market: 'hk', board: '港股主板', lotSize: 100, currency: 'HKD', priceLimitRatio: 0, tags: ['港股', 'T+0'] }
  }
  if (raw.startsWith('688')) {
    return { market: 'sh', board: '科创板', lotSize: 200, currency: 'CNY', priceLimitRatio: 0.2, tags: ['高波动', '硬科技'] }
  }
  if (raw.startsWith('300') || raw.startsWith('301')) {
    return { market: 'sz', board: '创业板', lotSize: 100, currency: 'CNY', priceLimitRatio: 0.2, tags: ['成长股', '高波动'] }
  }
  if (raw.startsWith('8') || raw.startsWith('4') || raw.startsWith('9')) {
    return { market: 'bj', board: '北交所', lotSize: 100, currency: 'CNY', priceLimitRatio: 0.3, tags: ['专精特新', '高弹性'] }
  }
  if (raw.startsWith('6')) {
    return { market: 'sh', board: '沪市主板', lotSize: 100, currency: 'CNY', priceLimitRatio: 0.1, tags: ['蓝筹', '主板'] }
  }
  if (raw.startsWith('0') || raw.startsWith('2')) {
    return { market: 'sz', board: '深市主板', lotSize: 100, currency: 'CNY', priceLimitRatio: 0.1, tags: ['主板'] }
  }
  return { market: 'sz', board: '深市', lotSize: 100, currency: 'CNY', priceLimitRatio: 0.1, tags: ['A股'] }
}

export function getLimitPrices(code: string, preClose: number) {
  const profile = getStockProfile(code)
  const ratio = profile.priceLimitRatio
  return {
    limitUp: round(preClose * (1 + ratio)),
    limitDown: round(preClose * (1 - ratio)),
    ratio,
  }
}

export function buildTechnicalSnapshot(data: KlineData[]): TechnicalSnapshot {
  if (!data.length) {
    return {
      ma5: 0,
      ma10: 0,
      ma20: 0,
      ma60: 0,
      rsi14: 0,
      dif: 0,
      dea: 0,
      macd: 0,
      avgVolume5: 0,
      avgVolume20: 0,
      volumeRatio: 0,
      supportPrice: 0,
      resistancePrice: 0,
      trend: 'neutral',
      momentum: 'weak',
    }
  }

  const closes = data.map((item) => item.close)
  const volumes = data.map((item) => item.volume)
  const latest = data[data.length - 1]
  const ma5 = average(closes.slice(-5))
  const ma10 = average(closes.slice(-10))
  const ma20 = average(closes.slice(-20))
  const ma60 = average(closes.slice(-60))
  const avgVolume5 = average(volumes.slice(-5))
  const avgVolume20 = average(volumes.slice(-20))
  const volumeRatio = avgVolume5 && avgVolume20 ? avgVolume5 / avgVolume20 : 0

  const gains: number[] = []
  const losses: number[] = []
  for (let i = Math.max(1, closes.length - 14); i < closes.length; i += 1) {
    const diff = closes[i] - closes[i - 1]
    gains.push(diff > 0 ? diff : 0)
    losses.push(diff < 0 ? Math.abs(diff) : 0)
  }
  const avgGain = average(gains)
  const avgLoss = average(losses)
  const rsi14 = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss)

  const ema12 = ema(closes, 12)
  const ema26 = ema(closes, 26)
  const difSeries = closes.map((_, index) => ema12[index] - ema26[index])
  const deaSeries = ema(difSeries, 9)
  const dif = difSeries[difSeries.length - 1] ?? 0
  const dea = deaSeries[deaSeries.length - 1] ?? 0
  const macd = (dif - dea) * 2

  const recent = data.slice(-20)
  const supportPrice = Math.min(...recent.map((item) => item.low))
  const resistancePrice = Math.max(...recent.map((item) => item.high))
  const trend: TechnicalSnapshot['trend'] =
    latest.close > ma5 && ma5 > ma10 && ma10 > ma20 ? 'bullish' : latest.close < ma5 && ma5 < ma10 ? 'bearish' : 'neutral'
  const momentum: TechnicalSnapshot['momentum'] =
    macd > 0 && rsi14 > 55 ? 'strong' : macd < 0 && rsi14 < 45 ? 'weak' : 'moderate'

  return {
    ma5: round(ma5),
    ma10: round(ma10),
    ma20: round(ma20),
    ma60: round(ma60),
    rsi14: round(rsi14),
    dif: round(dif, 4),
    dea: round(dea, 4),
    macd: round(macd, 4),
    avgVolume5: round(avgVolume5),
    avgVolume20: round(avgVolume20),
    volumeRatio: round(volumeRatio, 3),
    supportPrice: round(supportPrice),
    resistancePrice: round(resistancePrice),
    trend,
    momentum,
  }
}

export function summariseKlines(data: KlineData[]) {
  const technical = buildTechnicalSnapshot(data)
  const recent = data.slice(-5).map((item) => ({
    date: new Date(item.timestamp).toISOString().slice(0, 10),
    open: round(item.open),
    high: round(item.high),
    low: round(item.low),
    close: round(item.close),
    volume: round(item.volume),
  }))
  return { technical, recent }
}
