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
  const currentMarket = ref<'a' | 'hk' | 'us'>('a')
  const indicesUpdatedAt = ref(0)
  const advanceDeclineUpdatedAt = ref(0)
  const quotesUpdatedAt = ref(0)
  const sectorsUpdatedAt = ref(0)
  const stockListUpdatedAt = ref(0)

  function syncLegacyWatchList() {
    settingsStore.settings.watchList.stocks = [...watchList.value]
    void settingsStore.saveSettings()
  }

  async function fetchIndices(market: 'a' | 'hk' | 'us' = currentMarket.value) {
    try {
      currentMarket.value = market
      const { get } = useSidecar()
      const res = await get<{ data: MarketIndex[] }>(`/api/market/indices?market=${market}`)
      indices.value = res.data
      indicesUpdatedAt.value = Date.now()
    } catch (e) {
      console.error('Failed to fetch indices:', e)
    }
  }

  async function fetchAdvanceDecline() {
    try {
      const { get } = useSidecar()
      const res = await get<{ data: AdvanceDecline }>('/api/market/advance-decline')
      if (res.data && (res.data.advance > 0 || res.data.decline > 0)) {
        advanceDecline.value = res.data
        advanceDeclineUpdatedAt.value = Date.now()
      }
    } catch (e) {
      console.error('Failed to fetch advance/decline:', e)
    }
  }

  async function fetchStockList(market: 'a' | 'hk' | 'us' = currentMarket.value, page = 1, pageSize = 50) {
    loading.value = true
    try {
      const { get } = useSidecar()
      const res = await get<{ data: StockListItem[]; total: number; page: number }>(
        `/api/market/stocks?market=${market}&page=${page}&pageSize=${pageSize}`
      )
      stockList.value = res.data
      stockListTotal.value = res.total
      stockListPage.value = res.page
      stockListUpdatedAt.value = Date.now()
    } catch (e) {
      console.error('Failed to fetch stock list:', e)
    } finally {
      loading.value = false
    }
  }

  async function fetchQuotes(codes: string[]) {
    loading.value = true
    try {
      const { get } = useSidecar()
      const res = await get<{ data: StockQuote[] }>(`/api/market/quotes?codes=${codes.join(',')}`)
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
    sectorLoading.value = true
    try {
      const { get } = useSidecar()
      const path = type === 'industry' ? '/api/sector/industry' : '/api/sector/concept'
      const res = await get<{ data: SectorData[] }>(path)
      sectors.value = res.data
      sectorsUpdatedAt.value = Date.now()
    } catch (e) {
      console.error('Failed to fetch sectors:', e)
    } finally {
      sectorLoading.value = false
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
  }
})
