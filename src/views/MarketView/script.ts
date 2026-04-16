import { computed, defineComponent, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import StockSearchInput from '@/components/common/StockSearchInput/index.vue'
import { useSidecar } from '@/composables/useSidecar'
import { useRealtimeTask } from '@/composables/useRealtimeTask'
import { useMarketStore } from '@/stores/market'
import { useSettingsStore } from '@/stores/settings'
import type { SectorData, StockListItem, StockQuote } from '@/types'
import { formatAmount, formatPercent, formatPrice, formatVolume } from '@/utils/format'
import { getStockProfile } from '@/utils/marketMetrics'
import { normalizeSecurityCode } from '@/utils/security'

type MarketType = 'a' | 'hk' | 'us'
type SectorDimension = 'industry' | 'concept'

interface SectorFilterOption {
  code: string
  name: string
  companyCount?: number
  symbols?: string[]
}

const OVERSEAS_SECTOR_PRESETS: Record<Exclude<MarketType, 'a'>, SectorFilterOption[]> = {
  hk: [
    { code: 'hk-tech', name: '科技互联网', symbols: ['00700', '09988', '03690', '01810', '09618'] },
    { code: 'hk-finance', name: '金融红利', symbols: ['00005', '00939', '01398', '02318', '01299'] },
    { code: 'hk-consumer', name: '消费医药', symbols: ['02319', '02269', '01093', '02331', '09626'] },
    { code: 'hk-energy', name: '能源制造', symbols: ['00883', '00857', '00386', '01772', '09868'] },
  ],
  us: [
    { code: 'us-mega', name: '科技巨头', symbols: ['AAPL', 'MSFT', 'AMZN', 'META', 'GOOGL'] },
    { code: 'us-chip', name: '半导体 AI', symbols: ['NVDA', 'AMD', 'AVGO', 'TSM', 'SMCI'] },
    { code: 'us-china', name: '中概互联网', symbols: ['BABA', 'PDD', 'JD', 'BIDU', 'TME'] },
    { code: 'us-ev', name: '新能源出行', symbols: ['TSLA', 'NIO', 'LI', 'XPEV'] },
  ],
}

function normalizeMenuKey(value: string) {
  const normalized = normalizeSecurityCode(value).toUpperCase()
  if (/^\d+$/.test(normalized)) {
    return normalized.padStart(5, '0')
  }
  return normalized
}

export default defineComponent({
  name: 'MarketView',
  components: { StockSearchInput },
  setup() {
    const router = useRouter()
    const marketStore = useMarketStore()
    const settingsStore = useSettingsStore()
    const { get } = useSidecar()
    const currentMarket = ref<MarketType>('a')
    const currentPage = ref(1)
    const pageSize = 80
    const allStocks = ref<StockListItem[]>([])
    const sectorStocks = ref<StockListItem[]>([])
    const industryLeaders = ref<SectorData[]>([])
    const conceptLeaders = ref<SectorData[]>([])
    const hasMore = ref(true)
    const loadingMore = ref(false)
    const sectorLoading = ref(false)
    const keywordSearching = ref(false)
    const tableContainer = ref<HTMLElement | null>(null)
    const searchKeyword = ref('')
    const keywordMatchedStocks = ref<StockListItem[]>([])
    const sectorDimension = ref<SectorDimension>('industry')
    const selectedSectorCodes = ref<string[]>([])
    const sectorExpanded = ref(false)
    let keywordSearchTimer: ReturnType<typeof setTimeout> | null = null
    let keywordSearchToken = 0

    const marketTabs = [
      { value: 'a' as MarketType, label: 'A股' },
      { value: 'hk' as MarketType, label: '港股' },
      { value: 'us' as MarketType, label: '美股' },
    ]
    const realtimeMarket = computed(() => currentMarket.value)

    function clearKeywordSearchTimer() {
      if (keywordSearchTimer) {
        clearTimeout(keywordSearchTimer)
        keywordSearchTimer = null
      }
    }

    function resolveMarketType(code: string): MarketType {
      const profile = getStockProfile(code)
      if (profile.market === 'hk') return 'hk'
      if (profile.market === 'us') return 'us'
      return 'a'
    }

    function normalizeQuoteToListItem(item: StockQuote): StockListItem {
      return {
        code: normalizeSecurityCode(item.code),
        name: item.name,
        price: item.price,
        change: item.change,
        changePercent: item.changePercent,
        open: item.open,
        high: item.high,
        low: item.low,
        preClose: item.preClose,
        volume: item.volume,
        amount: item.amount,
        turnover: item.turnover,
      }
    }

    function appendSelectedSectorTags(stocks: StockListItem[]) {
      if (currentMarket.value === 'a' || !selectedSectorCodes.value.length) return stocks
      return stocks.map((item) => ({
        ...item,
        sectorTags: selectedSectorCodes.value
          .map((code) => selectedSectorMap.value.get(code))
          .filter((option) => option?.symbols?.some((symbol) => normalizeMenuKey(symbol) === normalizeMenuKey(item.code)))
          .map((option) => option?.name || ''),
      }))
    }

    async function refreshKeywordMatches(keyword = searchKeyword.value) {
      const trimmed = keyword.trim()
      const currentToken = ++keywordSearchToken

      if (!trimmed) {
        keywordMatchedStocks.value = []
        keywordSearching.value = false
        return
      }

      keywordSearching.value = true
      const matched = await marketStore.searchStock(trimmed)
      if (currentToken !== keywordSearchToken) return

      keywordMatchedStocks.value = matched
        .map(normalizeQuoteToListItem)
        .filter((item) => resolveMarketType(item.code) === currentMarket.value)
      keywordSearching.value = false
    }

    const sectorOptions = computed<SectorFilterOption[]>(() => {
      if (currentMarket.value === 'a') {
        const source = sectorDimension.value === 'industry' ? industryLeaders.value : conceptLeaders.value
        return source.map((item) => ({
          code: item.code,
          name: item.name,
          companyCount: item.companyCount,
        }))
      }
      return OVERSEAS_SECTOR_PRESETS[currentMarket.value]
    })
    const visibleSectorOptions = computed(() => (sectorExpanded.value ? sectorOptions.value : sectorOptions.value.slice(0, 8)))
    const sectorMoreAvailable = computed(() => sectorOptions.value.length > 8)

    const selectedSectorNames = computed(() => {
      const allOptions = [
        ...industryLeaders.value.map((item) => ({ code: item.code, name: item.name })),
        ...conceptLeaders.value.map((item) => ({ code: item.code, name: item.name })),
        ...OVERSEAS_SECTOR_PRESETS.hk.map((item) => ({ code: item.code, name: item.name })),
        ...OVERSEAS_SECTOR_PRESETS.us.map((item) => ({ code: item.code, name: item.name })),
      ]
      const lookup = new Map(allOptions.map((item) => [item.code, item.name]))
      return selectedSectorCodes.value.map((code) => lookup.get(code) || code)
    })

    const selectedSectorMap = computed(() => {
      const options = OVERSEAS_SECTOR_PRESETS[currentMarket.value as Exclude<MarketType, 'a'>] || []
      return new Map(options.map((item) => [item.code, item]))
    })

    const searchActive = computed(() => !!searchKeyword.value.trim())

    const candidateStocks = computed(() => (searchActive.value ? keywordMatchedStocks.value : allStocks.value))

    const baseStocks = computed(() => {
      if (currentMarket.value === 'a' && selectedSectorCodes.value.length) {
        if (!searchActive.value) return sectorStocks.value
        const selectedCodes = new Set(sectorStocks.value.map((item) => normalizeSecurityCode(item.code)))
        return keywordMatchedStocks.value.filter((item) => selectedCodes.has(normalizeSecurityCode(item.code)))
      }

      if (currentMarket.value !== 'a' && selectedSectorCodes.value.length) {
        const symbolSet = new Set(
          selectedSectorCodes.value.flatMap((code) => selectedSectorMap.value.get(code)?.symbols?.map((item) => normalizeMenuKey(item)) || []),
        )
        return appendSelectedSectorTags(
          candidateStocks.value.filter((item) => symbolSet.has(normalizeMenuKey(item.code))),
        )
      }

      return candidateStocks.value
    })

    const filteredStocks = computed(() => baseStocks.value)

    const currentLoadedCount = computed(() => {
      if (searchActive.value) return keywordMatchedStocks.value.length
      if (currentMarket.value === 'a' && selectedSectorCodes.value.length) return sectorStocks.value.length
      return allStocks.value.length
    })

    const refreshSeconds = computed(() => Math.round(realtimeRefresh.resolvedInterval.value / 1000))
    const dataRealtimeEnabled = computed(() => settingsStore.settings.dataSource.realTimeEnabled)

    async function loadPage(page: number, append = false) {
      if (!hasMore.value && append) return
      loadingMore.value = true
      try {
        const res = await get<{ data: StockListItem[]; total: number; page: number }>(
          `/api/market/stocks?market=${currentMarket.value}&page=${page}&pageSize=${pageSize}`,
        )
        if (append) {
          const existing = new Set(allStocks.value.map((item) => item.code))
          allStocks.value = [...allStocks.value, ...res.data.filter((item) => !existing.has(item.code))]
        } else {
          allStocks.value = res.data
        }
        hasMore.value = allStocks.value.length < res.total
        currentPage.value = page
      } catch (error) {
        console.error('Failed to load stocks:', error)
      } finally {
        loadingMore.value = false
      }
    }

    async function loadSectorDimension() {
      if (currentMarket.value !== 'a') {
        industryLeaders.value = []
        conceptLeaders.value = []
        return
      }

      try {
        const [industryRes, conceptRes] = await Promise.all([
          get<{ data: SectorData[] }>('/api/sector/industry'),
          get<{ data: SectorData[] }>('/api/sector/concept'),
        ])
        industryLeaders.value = industryRes.data ?? []
        conceptLeaders.value = conceptRes.data ?? []
      } catch (error) {
        console.error('Failed to load sectors:', error)
      }
    }

    async function loadSelectedSectorStocks() {
      if (currentMarket.value !== 'a' || !selectedSectorCodes.value.length) {
        sectorStocks.value = []
        return
      }

      sectorLoading.value = true
      try {
        const res = await get<{ data: StockListItem[] }>(
          `/api/sector/members?codes=${encodeURIComponent(selectedSectorCodes.value.join(','))}&pageSize=180`,
        )
        sectorStocks.value = res.data ?? []
      } catch (error) {
        console.error('Failed to load sector members:', error)
        sectorStocks.value = []
      } finally {
        sectorLoading.value = false
      }
    }

    async function switchMarket(market: MarketType) {
      currentMarket.value = market
      currentPage.value = 1
      hasMore.value = true
      allStocks.value = []
      sectorStocks.value = []
      searchKeyword.value = ''
      keywordMatchedStocks.value = []
      selectedSectorCodes.value = []
      sectorExpanded.value = false
      await Promise.all([
        loadPage(1, false),
        market === 'a' ? loadSectorDimension() : Promise.resolve(),
      ])
    }

    async function toggleSector(code: string) {
      if (selectedSectorCodes.value.includes(code)) {
        selectedSectorCodes.value = selectedSectorCodes.value.filter((item) => item !== code)
      } else {
        selectedSectorCodes.value = [...selectedSectorCodes.value, code]
      }

      if (currentMarket.value === 'a') {
        await loadSelectedSectorStocks()
      }
    }

    async function clearSectors() {
      selectedSectorCodes.value = []
      sectorStocks.value = []
      if (currentMarket.value === 'a') {
        await loadPage(1, false)
      }
    }

    function handleScroll() {
      if (searchActive.value) return
      if (currentMarket.value === 'a' && selectedSectorCodes.value.length) return
      if (!tableContainer.value || loadingMore.value || !hasMore.value) return
      const { scrollTop, scrollHeight, clientHeight } = tableContainer.value
      if (scrollTop + clientHeight >= scrollHeight - 160) {
        void loadPage(currentPage.value + 1, true)
      }
    }

    function navigateToStock(code: string) {
      router.push({ name: 'stockDetail', params: { code: normalizeSecurityCode(code) } })
    }

    function formatMarketCap(val: number): string {
      if (val >= 1e12) return `${(val / 1e12).toFixed(2)}万亿`
      if (val >= 1e8) return `${(val / 1e8).toFixed(2)}亿`
      return val.toFixed(0)
    }

    function formatAmplitude(stock: StockListItem) {
      if (!stock.preClose) return '--'
      return `${(((stock.high - stock.low) / stock.preClose) * 100).toFixed(2)}%`
    }

    function getBoardLabel(code: string) {
      if (currentMarket.value === 'hk') return '港股主板'
      if (currentMarket.value === 'us') return '美股'
      return getStockProfile(code).board
    }

    function getDisplaySector(stock: StockListItem) {
      if (stock.sectorTags?.length) return stock.sectorTags.join(' / ')
      return getBoardLabel(stock.code)
    }

    function handleSelectStock(item: StockQuote) {
      if (resolveMarketType(item.code) !== currentMarket.value) {
        keywordMatchedStocks.value = []
        return
      }
      keywordMatchedStocks.value = [normalizeQuoteToListItem(item)]
    }

    const realtimeRefresh = useRealtimeTask(async () => {
      if (searchActive.value) {
        await refreshKeywordMatches()
        return
      }
      if (currentMarket.value === 'a' && selectedSectorCodes.value.length) {
        await loadSelectedSectorStocks()
        return
      }

      const loadedCount = Math.max(allStocks.value.length, pageSize)
      const res = await get<{ data: StockListItem[]; total: number }>(
        `/api/market/stocks?market=${currentMarket.value}&page=1&pageSize=${loadedCount}`,
      )
      allStocks.value = res.data ?? []
      hasMore.value = allStocks.value.length < (res.total || 0)
    }, {
      intervalMultiplier: 1,
      immediate: false,
      minimumMs: 3000,
      pauseWhenHidden: true,
      market: () => realtimeMarket.value,
      skipWhenMarketClosed: true,
    })

    const sectorRefresh = useRealtimeTask(async () => {
      if (currentMarket.value !== 'a') return
      await loadSectorDimension()
      if (selectedSectorCodes.value.length) {
        await loadSelectedSectorStocks()
      }
    }, {
      intervalMultiplier: 1,
      immediate: false,
      minimumMs: 3000,
      pauseWhenHidden: true,
      market: () => realtimeMarket.value,
      skipWhenMarketClosed: true,
    })

    watch(sectorDimension, () => {
      selectedSectorCodes.value = []
      sectorStocks.value = []
      sectorExpanded.value = false
    })

    watch(searchKeyword, (value) => {
      clearKeywordSearchTimer()
      if (!value.trim()) {
        keywordSearchToken += 1
        keywordMatchedStocks.value = []
        keywordSearching.value = false
        return
      }
      keywordSearchTimer = setTimeout(() => {
        void refreshKeywordMatches(value)
      }, 220)
    })

    onMounted(async () => {
      await Promise.all([loadPage(1, false), loadSectorDimension()])
      realtimeRefresh.start(false)
      sectorRefresh.start(false)
    })

    onBeforeUnmount(() => {
      clearKeywordSearchTimer()
    })

    return {
      currentMarket,
      marketTabs,
      sectorDimension,
      sectorOptions,
      visibleSectorOptions,
      sectorExpanded,
      sectorMoreAvailable,
      selectedSectorCodes,
      selectedSectorNames,
      searchKeyword,
      allStocks,
      filteredStocks,
      keywordSearching,
      hasMore,
      loadingMore,
      sectorLoading,
      tableContainer,
      currentLoadedCount,
      dataRealtimeEnabled,
      formatPrice,
      formatPercent,
      formatVolume,
      formatAmount,
      formatMarketCap,
      formatAmplitude,
      getDisplaySector,
      refreshSeconds,
      switchMarket,
      toggleSector,
      clearSectors,
      refreshKeywordMatches,
      handleSelectStock,
      navigateToStock,
      handleScroll,
    }
  },
})
