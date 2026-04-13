const COLOR_UP = '#e84057'
const COLOR_DOWN = '#2ebd6e'
const COLOR_FLAT = '#9ba4b8'

export function getChangeColor(change: number): string {
  if (change > 0) return COLOR_UP
  if (change < 0) return COLOR_DOWN
  return COLOR_FLAT
}

export function getSentimentColor(sentiment: string): string {
  switch (sentiment) {
    case 'positive': return '#2ebd6e'
    case 'negative': return '#e84057'
    case 'neutral': return '#f5a623'
    default: return COLOR_FLAT
  }
}

export function getSentimentLabel(sentiment: string): string {
  switch (sentiment) {
    case 'positive': return '利好'
    case 'negative': return '利空'
    case 'neutral': return '中性'
    default: return '未知'
  }
}

export function getSentimentIcon(sentiment: string): string {
  switch (sentiment) {
    case 'positive': return '😊'
    case 'negative': return '😟'
    case 'neutral': return '😐'
    default: return '❓'
  }
}

export function getSignalTypeColor(type: string): string {
  switch (type) {
    case 'buy': return COLOR_UP
    case 'sell': return COLOR_DOWN
    case 'hold': return COLOR_FLAT
    default: return COLOR_FLAT
  }
}

export function getSignalTypeLabel(type: string): string {
  switch (type) {
    case 'buy': return '买入'
    case 'sell': return '卖出'
    case 'hold': return '持有'
    default: return '未知'
  }
}

export function sentimentColorClass(s: string): string {
  switch (s) {
    case 'positive': return 'tag-positive'
    case 'negative': return 'tag-negative'
    case 'neutral': return 'tag-neutral'
    default: return 'tag-info'
  }
}

export function sentimentText(s: string): string {
  switch (s) {
    case 'positive': return '利好'
    case 'negative': return '利空'
    case 'neutral': return '中性'
    default: return '未知'
  }
}
