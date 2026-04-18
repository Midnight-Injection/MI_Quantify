import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { StockQuote, MarketIndex, WatchListStock, SectorData, AdvanceDecline, StockListItem } from '@/types'
import { useSidecar } from '@/composables/useSidecar'
import { normalizeSecurityCode } from '@/utils/security'
import { useSettingsStore } from './settings'
import {
  listPersistedWatchlist,
  removePersistedWatchlist,
  upsertPersistedWatchlist,
} from '@/utils/monitorPersistence'

export const useMarketStore = defineStore('market', () => {
  type MarketCode = 'a' | 'hk' | 'us'
  interface MarketSnapshot {
    advanceDecline: AdvanceDecline
    advanceDeclineUpdatedAt: number
    indices: MarketIndex[]
    indicesUpdatedAt: number
    sectors: SectorData[]
    sectorsUpdatedAt: number
    stockList: StockListItem[]
    stockListPage: number
    stockListTotal: number
    stockListUpdatedAt: number
  }

  const settingsStore = useSettingsStore()
  const indices = ref<MarketIndex[]>([])
  const advanceDecline = ref<AdvanceDecline>({
    advance: 0,
    decline: 0,
    flat: 0,
    total: 0,
    totalAmount: 0,
  })
  const watchList = ref<WatchListStock[]>([])
  const quotes = ref<Map<string, StockQuote>>(new Map())
  const sectors = ref<SectorData[]>([])
  const stockList = ref<StockListItem[]>([])
  const stockListTotal = ref(0)
  const stockListPage = ref(1)
  const loading = ref(false)
  const sectorLoading = ref(false)
  const currentMarket = ref<MarketCode>('a')
  let fetchGeneration = 0
  const indicesUpdatedAt = ref(0)
  const advanceDeclineUpdatedAt = ref(0)
  const quotesUpdatedAt = ref(0)
  const sectorsUpdatedAt = ref(0)
  const stockListUpdatedAt = ref(0)
  const marketSnapshots = new Map<MarketCode, MarketSnapshot>()

  function buildEmptyAdvanceDecline(): AdvanceDecline {
    return { advance: 0, decline: 0, flat: 0, total: 0, totalAmount: 0 }
  }

  function getSnapshot(market: MarketCode): MarketSnapshot {
    const existing = marketSnapshots.get(market)
    if (existing) return existing
    const snapshot: MarketSnapshot = {
      advanceDecline: buildEmptyAdvanceDecline(),
      advanceDeclineUpdatedAt: 0,
      indices: [],
      indicesUpdatedAt: 0,
      sectors: [],
      sectorsUpdatedAt: 0,
      stockList: [],
      stockListPage: 1,
      stockListTotal: 0,
      stockListUpdatedAt: 0,
    }
    marketSnapshots.set(market, snapshot)
    return snapshot
  }

  function applySnapshot(market: MarketCode) {
    const snapshot = marketSnapshots.get(market)
    if (!snapshot) return false
    indices.value = [...snapshot.indices]
    advanceDecline.value = { ...snapshot.advanceDecline }
    sectors.value = [...snapshot.sectors]
    stockList.value = [...snapshot.stockList]
    stockListTotal.value = snapshot.stockListTotal
    stockListPage.value = snapshot.stockListPage
    indicesUpdatedAt.value = snapshot.indicesUpdatedAt
    advanceDeclineUpdatedAt.value = snapshot.advanceDeclineUpdatedAt
    sectorsUpdatedAt.value = snapshot.sectorsUpdatedAt
    stockListUpdatedAt.value = snapshot.stockListUpdatedAt
    return snapshot.indices.length > 0 || snapshot.stockList.length > 0 || snapshot.sectors.length > 0
  }

  function hasFreshSnapshotData(market: MarketCode, key: 'indices' | 'stockList' | 'sectors' | 'advanceDecline', maxAgeMs: number) {
    const snapshot = marketSnapshots.get(market)
    if (!snapshot) return false
    const updatedAtKey = `${key}UpdatedAt` as const
    return snapshot[updatedAtKey] > 0 && Date.now() - snapshot[updatedAtKey] < maxAgeMs
  }

  function hasPrimarySnapshot(market: MarketCode) {
    const snapshot = marketSnapshots.get(market)
    return !!snapshot && (snapshot.indices.length > 0 || snapshot.stockList.length > 0)
  }

  function syncLegacyWatchList() {
    settingsStore.settings.watchList.stocks = [...watchList.value]
    void settingsStore.saveSettings()
  }

  async function fetchIndices(market: MarketCode = currentMarket.value) {
    const gen = fetchGeneration
    try {
      currentMarket.value = market
      const { get } = useSidecar()
      const res = await get<{ data: MarketIndex[] }>(`/api/market/indices?market=${market}`)
      if (gen !== fetchGeneration) return
      const nextData = res.data ?? []
      if (nextData.length || !indices.value.length) {
        indices.value = nextData
      }
      if (nextData.length) {
        indicesUpdatedAt.value = Date.now()
        const snapshot = getSnapshot(market)
        snapshot.indices = [...nextData]
        snapshot.indicesUpdatedAt = indicesUpdatedAt.value
      }
    } catch (e) {
      if (gen !== fetchGeneration) return
      console.error('Failed to fetch indices:', e)
    }
  }

  async function fetchAdvanceDecline() {
    const gen = fetchGeneration
    try {
      const { get } = useSidecar()
      const res = await get<{ data: AdvanceDecline }>('/api/market/advance-decline')
      if (gen !== fetchGeneration) return
      if (res.data && (res.data.advance > 0 || res.data.decline > 0)) {
        advanceDecline.value = res.data
        advanceDeclineUpdatedAt.value = Date.now()
        const snapshot = getSnapshot('a')
        snapshot.advanceDecline = { ...res.data }
        snapshot.advanceDeclineUpdatedAt = advanceDeclineUpdatedAt.value
      }
    } catch (e) {
      if (gen !== fetchGeneration) return
      console.error('Failed to fetch advance/decline:', e)
    }
  }

  async function fetchStockList(market: MarketCode = currentMarket.value, page = 1, pageSize = 50) {
    const gen = fetchGeneration
    loading.value = true
    try {
      currentMarket.value = market
      const { get } = useSidecar()
      const res = await get<{ data: StockListItem[]; total: number; page: number }>(
        `/api/market/stocks?market=${market}&page=${page}&pageSize=${pageSize}`
      )
      if (gen !== fetchGeneration) return
      const nextData = res.data ?? []
      if (nextData.length || !stockList.value.length) {
        stockList.value = nextData
        stockListTotal.value = res.total
        stockListPage.value = res.page
      }
      if (nextData.length) {
        stockListUpdatedAt.value = Date.now()
        const snapshot = getSnapshot(market)
        snapshot.stockList = [...nextData]
        snapshot.stockListTotal = res.total
        snapshot.stockListPage = res.page
        snapshot.stockListUpdatedAt = stockListUpdatedAt.value
      }
    } catch (e) {
      if (gen !== fetchGeneration) return
      console.error('Failed to fetch stock list:', e)
    } finally {
      if (gen === fetchGeneration) {
        loading.value = false
      }
    }
  }

  async function fetchQuotes(codes: string[]) {
    loading.value = true
    try {
      const { get } = useSidecar()
      const res = await get<{ data: StockQuote[] }>(`/api/market/quotes?codes=${codes.join(',')}`)
      if (!res.data?.length && quotes.value.size) {
        return
      }
      const map = new Map<string, StockQuote>()
      for (const q of res.data) {
        map.set(q.code, q)
      }
      quotes.value = map
      quotesUpdatedAt.value = Date.now()
    } catch (e) {
      console.error('Failed to fetch quotes:', e)
    } finally {
      loading.value = false
    }
  }

  async function fetchSectors(type: 'industry' | 'concept' = 'industry') {
    const gen = fetchGeneration
    sectorLoading.value = true
    try {
      const { get } = useSidecar()
      const path = type === 'industry' ? '/api/sector/industry' : '/api/sector/concept'
      const res = await get<{ data: SectorData[] }>(path)
      if (gen !== fetchGeneration) return
      const nextData = res.data ?? []
      if (nextData.length || !sectors.value.length) {
        sectors.value = nextData
      }
      if (nextData.length) {
        sectorsUpdatedAt.value = Date.now()
        const snapshot = getSnapshot('a')
        snapshot.sectors = [...nextData]
        snapshot.sectorsUpdatedAt = sectorsUpdatedAt.value
      }
    } catch (e) {
      if (gen !== fetchGeneration) return
      console.error('Failed to fetch sectors:', e)
    } finally {
      if (gen === fetchGeneration) {
        sectorLoading.value = false
      }
    }
  }

  async function searchStock(keyword: string): Promise<StockQuote[]> {
    try {
      const { get } = useSidecar()
      const res = await get<{ data: StockQuote[] }>(`/api/market/search?keyword=${encodeURIComponent(keyword)}`)
      return (res.data || []).map((item) => ({
        ...item,
        code: normalizeSecurityCode(item.code),
      }))
    } catch (e) {
      console.error('Failed to search stock:', e)
      return []
    }
  }

  async function hydrateWatchList() {
    try {
      const persisted = await listPersistedWatchlist()
      if (persisted.length) {
        watchList.value = persisted
        syncLegacyWatchList()
        return
      }
    } catch (error) {
      console.warn('[watchlist] db hydrate failed, fallback to settings:', error)
    }

    const legacy = [...(settingsStore.settings.watchList.stocks ?? [])]
    watchList.value = legacy
    for (const item of legacy) {
      try {
        await upsertPersistedWatchlist(item)
      } catch (error) {
        console.warn('[watchlist] legacy import failed:', error)
      }
    }
    syncLegacyWatchList()
  }

  async function addToWatchList(stock: WatchListStock) {
    if (!watchList.value.find((s) => s.code === stock.code)) {
      watchList.value = [stock, ...watchList.value]
      syncLegacyWatchList()
      try {
        await upsertPersistedWatchlist(stock)
      } catch (error) {
        console.warn('[watchlist] persist failed:', error)
      }
    }
  }

  async function removeFromWatchList(code: string) {
    watchList.value = watchList.value.filter((s) => s.code !== code)
    syncLegacyWatchList()
    try {
      await removePersistedWatchlist(code)
    } catch (error) {
      console.warn('[watchlist] remove failed:', error)
    }
  }

  function clearMarketData(market: MarketCode) {
    currentMarket.value = market
    fetchGeneration++
    if (applySnapshot(market)) return
    stockList.value = []
    stockListTotal.value = 0
    stockListPage.value = 1
    indices.value = []
    sectors.value = []
    advanceDecline.value = buildEmptyAdvanceDecline()
    indicesUpdatedAt.value = 0
    advanceDeclineUpdatedAt.value = 0
    sectorsUpdatedAt.value = 0
    stockListUpdatedAt.value = 0
  }

  return {
    indices,
    advanceDecline,
    watchList,
    quotes,
    sectors,
    stockList,
    stockListTotal,
    stockListPage,
    loading,
    sectorLoading,
    currentMarket,
    indicesUpdatedAt,
    advanceDeclineUpdatedAt,
    quotesUpdatedAt,
    sectorsUpdatedAt,
    stockListUpdatedAt,
    fetchIndices,
    fetchAdvanceDecline,
    fetchStockList,
    fetchQuotes,
    fetchSectors,
    searchStock,
    hydrateWatchList,
    addToWatchList,
    removeFromWatchList,
    clearMarketData,
    hasFreshSnapshotData,
    hasPrimarySnapshot,
  }
})
