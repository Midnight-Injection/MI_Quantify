import type { FundFlow, MarketIndex, SectorData, StockListItem } from './stock'
import type { NewsItem } from './news'

export interface HomeMetricCard {
  label: string
  value: string | number
  detail: string
  tone: 'up' | 'down' | 'flat'
}

export interface HomeHeatmapCell {
  code: string
  label: string
  changePercent: number
  amount: number
  weight: number
  detail: string
}

export interface HomeStyleCell {
  label: string
  changePercent: number
  tone: 'up' | 'down' | 'flat'
  leader: string
  detail: string
}

export interface HomeBreadthSnapshot {
  advance: number
  decline: number
  flat: number
  total: number
  positiveRatio: number
  negativeRatio: number
  totalAmount: number
  sourceLabel: string
}

export interface HomeOverviewData {
  updatedAt: number
  summaryCards: HomeMetricCard[]
  indices: MarketIndex[]
  breadth: HomeBreadthSnapshot
  heatmap: HomeHeatmapCell[]
  styleMatrix: HomeStyleCell[]
  movers: {
    gainers: StockListItem[]
    losers: StockListItem[]
    active: StockListItem[]
    turnover: StockListItem[]
  }
}

export interface HomeBoardFlowItem {
  code: string
  name: string
  changePercent: number
  amount: number
  netFlowProxy?: number
  positiveCount?: number
  samples?: Array<{ code: string; name: string; mainNetInflow: number }>
}

export interface HomeFundflowData {
  updatedAt: number
  summaryCards: HomeMetricCard[]
  stockFlows: {
    inflow: Array<FundFlow | StockListItem>
    outflow: Array<FundFlow | StockListItem>
  }
  boardFlows: {
    industry: HomeBoardFlowItem[]
    concept: HomeBoardFlowItem[]
  }
  focusStock: {
    code: string
    history: Array<Record<string, unknown>>
  }
}

export interface HomeSectorLeader extends SectorData {
  members?: StockListItem[]
}

export interface HomeSectorData {
  updatedAt: number
  summaryCards: HomeMetricCard[]
  leaders: HomeSectorLeader[]
  industry: HomeSectorLeader[]
  concept: HomeSectorLeader[]
  heatmap: HomeHeatmapCell[]
  focusSector: HomeSectorLeader | null
  focusMembers: StockListItem[]
}

export interface HomeStockFocusData {
  code: string
  info: Record<string, any>
  finance: Record<string, any>
  fundflow: Array<Record<string, any>>
}

export interface HomeStocksData {
  updatedAt: number
  summaryCards: HomeMetricCard[]
  boards: {
    leaders: StockListItem[]
    losers: StockListItem[]
    active: StockListItem[]
    turnover: StockListItem[]
    breakouts: StockListItem[]
    defensive: StockListItem[]
  }
  focusStock: HomeStockFocusData
}

export interface HomeNewsGroup {
  label: string
  count: number
  tone: 'up' | 'down' | 'flat'
  items: NewsItem[]
}

export interface HomeHotTopic {
  label: string
  count: number
  headline: string
}

export interface HomeNewsData {
  updatedAt: number
  summaryCards: HomeMetricCard[]
  latest: NewsItem[]
  groups: HomeNewsGroup[]
  timeline: NewsItem[]
  hotTopics: HomeHotTopic[]
}

export interface HomeAiScenarioCard {
  label: string
  value: string
  detail: string
}

export interface HomeAiContextData {
  updatedAt: number
  evidenceCards: HomeMetricCard[]
  focusThemes: HomeSectorLeader[]
  scenarioCards: HomeAiScenarioCard[]
  candidates: StockListItem[]
  facts: string[]
}
