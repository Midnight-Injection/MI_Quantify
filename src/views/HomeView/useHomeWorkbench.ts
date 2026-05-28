import { computed, reactive, ref } from 'vue'
import { useSidecar } from '@/composables/useSidecar'
import type {
  HomeAiContextData,
  HomeFundflowData,
  HomeNewsData,
  HomeOverviewData,
  HomeSectorData,
  HomeStocksData,
} from '@/types'

type MarketType = 'a' | 'hk' | 'us'
type HomeTabKey = 'overview' | 'fundflow' | 'sector' | 'stocks' | 'news' | 'ai'
type TabState<T> = {
  data: T | null
  loading: boolean
  error: string
  updatedAt: number
}

/**
 * 批量响应中除 ai 以外的五面板数据结构
 */
type HomeBatchData = {
  overview: HomeOverviewData
  fundflow: HomeFundflowData
  sectors: HomeSectorData
  stocks: HomeStocksData
  news: HomeNewsData
}

const HOME_TAB_PATHS: Record<Exclude<HomeTabKey, 'ai'>, string> = {
  overview: '/api/home/overview',
  fundflow: '/api/home/fundflow',
  sector: '/api/home/sectors',
  stocks: '/api/home/stocks',
  news: '/api/home/news',
}

/**
 * 构建首页工作台的数据状态容器
 * @returns 首页各 tab 的加载器与状态
 */
export function useHomeWorkbench() {
  const { get } = useSidecar()
  const tabs = reactive({
    overview: { data: null, loading: false, error: '', updatedAt: 0 } as TabState<HomeOverviewData>,
    fundflow: { data: null, loading: false, error: '', updatedAt: 0 } as TabState<HomeFundflowData>,
    sector: { data: null, loading: false, error: '', updatedAt: 0 } as TabState<HomeSectorData>,
    stocks: { data: null, loading: false, error: '', updatedAt: 0 } as TabState<HomeStocksData>,
    news: { data: null, loading: false, error: '', updatedAt: 0 } as TabState<HomeNewsData>,
    ai: { data: null, loading: false, error: '', updatedAt: 0 } as TabState<HomeAiContextData>,
  })
  const market = ref<MarketType>('a')
  const loadSeq = ref(0)

  async function loadStructuredTab<T>(
    key: Exclude<HomeTabKey, 'ai'>,
    target: TabState<T>,
    nextMarket = market.value,
  ) {
    target.loading = true
    target.error = ''
    const seq = loadSeq.value
    try {
      const res = await get<{ data: T }>(`${HOME_TAB_PATHS[key]}?market=${nextMarket}`)
      if (seq !== loadSeq.value || nextMarket !== market.value) return
      target.data = res.data
      target.updatedAt = Date.now()
    } catch (error) {
      if (seq !== loadSeq.value || nextMarket !== market.value) return
      target.error = error instanceof Error ? error.message : String(error)
    } finally {
      if (seq === loadSeq.value && nextMarket === market.value) {
        target.loading = false
      }
    }
  }

  /**
   * 拉取 AI 证据上下文
   * @param nextMarket - 当前市场
   */
  async function loadAiContext(nextMarket = market.value) {
    const target = tabs.ai
    target.loading = true
    target.error = ''
    const seq = loadSeq.value
    try {
      const res = await get<{ data: HomeAiContextData }>(`/api/home/ai-context?market=${nextMarket}`)
      if (seq !== loadSeq.value || nextMarket !== market.value) return
      target.data = res.data
      target.updatedAt = Date.now()
    } catch (error) {
      if (seq !== loadSeq.value || nextMarket !== market.value) return
      target.error = error instanceof Error ? error.message : String(error)
    } finally {
      if (seq === loadSeq.value && nextMarket === market.value) {
        target.loading = false
      }
    }
  }

  const BATCH_TIMEOUT_MS = 12_000

  /**
   * 降级到分散 5 GET 拉取
   */
  async function fallbackToIndividual(nextMarket: MarketType, _currentSeq: number) {
    await Promise.allSettled([
      loadStructuredTab('overview', tabs.overview, nextMarket),
      loadStructuredTab('fundflow', tabs.fundflow, nextMarket),
      loadStructuredTab('sector', tabs.sector, nextMarket),
      loadStructuredTab('stocks', tabs.stocks, nextMarket),
      loadStructuredTab('news', tabs.news, nextMarket),
    ])
  }

  /**
   * 全量刷新首页工作台
   *
   * 使用 batch API 一次取回 5 面板数据，再分发到各 tab。
   * batch 超时或失败时降级为分散 5 GET。
   *
   * @param nextMarket - 切换后的市场
   */
  async function refreshAll(nextMarket = market.value) {
    loadSeq.value += 1
    const currentSeq = loadSeq.value
    market.value = nextMarket

    const batchTargets = [
      tabs.overview,
      tabs.fundflow,
      tabs.sector,
      tabs.stocks,
      tabs.news,
    ] as const
    batchTargets.forEach((t) => { t.loading = true; t.error = '' })

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), BATCH_TIMEOUT_MS)

    try {
      const res = await get<{ data: HomeBatchData }>(
        `/api/home/batch?market=${nextMarket}`,
        controller.signal,
      )
      clearTimeout(timer)
      if (currentSeq !== loadSeq.value || nextMarket !== market.value) return
      const d = res.data
      tabs.overview.data = d.overview
      tabs.fundflow.data = d.fundflow
      tabs.sector.data = d.sectors
      tabs.stocks.data = d.stocks
      tabs.news.data = d.news
      const now = Date.now()
      batchTargets.forEach((t) => { t.updatedAt = now; t.loading = false })
    } catch (error) {
      clearTimeout(timer)
      if (currentSeq !== loadSeq.value || nextMarket !== market.value) return

      const msg = error instanceof Error ? error.message : String(error)
      console.warn('[HomeWorkbench] batch failed, fallback to individual:', msg)

      batchTargets.forEach((t) => { t.loading = false; t.error = '' })
      await fallbackToIndividual(nextMarket, currentSeq)
    }

    if (currentSeq !== loadSeq.value) return
    await loadAiContext(nextMarket)
  }

  const isInitialLoading = computed(() =>
    tabs.overview.loading
    && !tabs.overview.data
    && tabs.fundflow.loading
    && tabs.sector.loading
    && tabs.stocks.loading,
  )

  return {
    tabs,
    market,
    isInitialLoading,
    refreshAll,
    loadAiContext,
  }
}
