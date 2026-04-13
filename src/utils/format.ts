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

export function formatAmount(amount: number): string {
  if (amount >= 100_000_000) return `${(amount / 100_000_000).toFixed(2)}亿`
  if (amount >= 10_000) return `${(amount / 10_000).toFixed(2)}万`
  return amount.toFixed(0)
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
