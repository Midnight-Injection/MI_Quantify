import { defineComponent, ref, computed, onActivated, onDeactivated, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useSidecar } from '@/composables/useSidecar'
import { useMarketStore } from '@/stores/market'
import { useNewsStore } from '@/stores/news'
import { useSettingsStore } from '@/stores/settings'
import { useRealtimeTask } from '@/composables/useRealtimeTask'
import { useAiInsights } from '@/composables/useAiInsights'
import { useAiTaskLogger } from '@/composables/useAiTaskLogger'
import type { AiInsightDigest, FundFlow, NewsItem } from '@/types'
import { formatAmount, formatPercent, formatPrice, formatVolume } from '@/utils/format'
import { getMarketSessionContext } from '@/utils/marketSession'
import InfoTooltip from '@/components/common/InfoTooltip/index.vue'

type MarketType = 'a' | 'hk' | 'us'

interface OverseasThemePreset {
  title: string
  symbols: string[]
}

const HOME_NEWS_LIMIT = 60
const HOME_PRIMARY_CACHE_TTL_MS = 45_000
const HOME_SECONDARY_CACHE_TTL_MS = 90_000
const HOME_RECOMMENDATION_QUOTE_MAX_AGE_MS = 120_000
const HOME_STOCK_PAGE_SIZES: Record<MarketType, number> = {
  a: 24,
  hk: 18,
  us: 18,
}

function computeTopAmountShare(items: Array<{ amount: number }>, take = 3) {
  if (!items.length) return 0
  const totalAmount = items.reduce((sum, item) => sum + (item.amount || 0), 0)
  if (!totalAmount) return 0
  const focusAmount = [...items]
    .sort((left, right) => (right.amount || 0) - (left.amount || 0))
    .slice(0, take)
    .reduce((sum, item) => sum + (item.amount || 0), 0)
  return (focusAmount / totalAmount) * 100
}

const OVERSEAS_THEME_PRESETS: Record<Exclude<MarketType, 'a'>, OverseasThemePreset[]> = {
  hk: [
    { title: '科技互联网', symbols: ['00700', '09988', '03690', '01810', '09618'] },
    { title: '金融红利', symbols: ['00005', '00939', '01398', '02318', '01299'] },
    { title: '消费医药', symbols: ['02319', '02269', '01093', '02331', '09626'] },
    { title: '能源制造', symbols: ['00883', '00857', '00386', '01772', '09868'] },
  ],
  us: [
    { title: '科技巨头', symbols: ['AAPL', 'MSFT', 'AMZN', 'META', 'GOOGL'] },
    { title: '半导体 AI', symbols: ['NVDA', 'AMD', 'AVGO', 'TSM', 'SMCI'] },
    { title: '中概互联网', symbols: ['BABA', 'PDD', 'JD', 'BIDU', 'TME'] },
    { title: '新能源出行', symbols: ['TSLA', 'NIO', 'LI', 'XPEV'] },
  ],
}

function buildNewsText(item: NewsItem) {
  return `${item.title} ${item.content || ''}`
}

function formatLocalDateToken(value: number | Date = new Date()) {
  const date = typeof value === 'number' ? new Date(value) : value
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function diffCalendarDays(startDate: string, endDate: string) {
  const start = new Date(`${startDate}T00:00:00Z`).getTime()
  const end = new Date(`${endDate}T00:00:00Z`).getTime()
  return Math.round((end - start) / (24 * 60 * 60 * 1000))
}

function getWeekday(timezone: string) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
  }).format(new Date())
}

function resolveAiDigestTitle(market: MarketType) {
  const session = getMarketSessionContext(market)
  const weekday = getWeekday(session.timezone)
  const [hourText = '0', minuteText = '0'] = session.currentTime.split(':')
  const minutes = Number(hourText) * 60 + Number(minuteText)
  const daysToNextOpen = diffCalendarDays(session.currentDate, session.nextOpenDate)
  const nextWeekTitle = weekday === 'Sat'
    || weekday === 'Sun'
    || ((session.phase === 'post_market' || session.phase === 'holiday_closed') && (weekday === 'Fri' || daysToNextOpen >= 3))

  if (session.phase === 'holiday_closed') {
    return nextWeekTitle ? '下周炒什么' : '明天炒什么'
  }

  if (session.phase === 'post_market') {
    return nextWeekTitle ? '下周炒什么' : '明天炒什么'
  }

  if (session.phase === 'midday_break') {
    return '下午炒什么'
  }

  if (session.phase === 'trading') {
    return minutes < 12 * 60 ? '早上炒什么' : '下午炒什么'
  }

  return '早上炒什么'
}

function uniqueCodes(codes: string[]) {
  return [...new Set(codes.map((item) => `${item || ''}`.trim()).filter(Boolean))]
}

export default defineComponent({
  name: 'HomeView',
  components: { InfoTooltip },
  setup() {
    const router = useRouter()
    const { get } = useSidecar()
    const marketStore = useMarketStore()
    const newsStore = useNewsStore()
    const settingsStore = useSettingsStore()
    const { generateDigest } = useAiInsights()
    const aiTaskLogger = useAiTaskLogger()
    const currentMarket = ref<MarketType>('a')
    const indexExpanded = ref(false)
    const sectorExpanded = ref(false)
    const aiDigest = ref<AiInsightDigest | null>(null)
    const aiDigestError = ref('')
    const aiDigestLoading = ref(false)
    const dashboardLoading = ref(true)
    const secondaryLoading = ref(true)
    const fundflowLeaders = ref<FundFlow[]>([])
    const fundflowUpdatedAt = ref(0)
    const lastDigestAt = ref(0)
    const homeLoadSeq = ref(0)

    const marketTabs = [
      { value: 'a' as MarketType, label: 'A股' },
      { value: 'hk' as MarketType, label: '港股' },
      { value: 'us' as MarketType, label: '美股' },
    ]
    const realtimeMarket = computed(() => currentMarket.value)
    const isTradingSession = computed(() => getMarketSessionContext(realtimeMarket.value).phase === 'trading')
    const heroRealtimeActive = computed(() => heroPolling.isRunning.value && isTradingSession.value)

    const indices = computed(() => marketStore.indices)
    const visibleIndices = computed(() => (indexExpanded.value ? indices.value : indices.value.slice(0, 8)))
    const adv = computed(() => marketStore.advanceDecline)
    const hotStocks = computed(() => marketStore.stockList.slice(0, 18))
    const sectorLeaders = computed(() =>
      [...marketStore.sectors]
        .sort((left, right) => {
          const leftHeat = left.changePercent * 14 + Math.log10((left.amount || 0) + 10) * 5 + Math.log10(left.volume + 10) * 1.4 + (left.companyCount || 0) * 0.18
          const rightHeat = right.changePercent * 14 + Math.log10((right.amount || 0) + 10) * 5 + Math.log10(right.volume + 10) * 1.4 + (right.companyCount || 0) * 0.18
          return rightHeat - leftHeat
        })
        .slice(0, sectorExpanded.value ? 80 : 12),
    )
    const overseasThemeLeaders = computed(() => {
      if (currentMarket.value === 'a') return []
      const presets = OVERSEAS_THEME_PRESETS[currentMarket.value]
      return presets.map((preset) => {
        const matches = marketStore.stockList.filter((item) => preset.symbols.includes(item.code.toUpperCase()))
        const avgChange = matches.length ? matches.reduce((sum, item) => sum + item.changePercent, 0) / matches.length : 0
        const totalAmount = matches.reduce((sum, item) => sum + item.amount, 0)
        const leader = [...matches].sort((left, right) => {
          if (right.changePercent !== left.changePercent) return right.changePercent - left.changePercent
          return right.amount - left.amount
        })[0]
        return {
          code: preset.title,
          name: preset.title,
          changePercent: avgChange,
          leadingStock: leader?.name || '待同步',
          leadingCode: leader?.code || '',
          companyCount: matches.length,
          averagePrice: matches.length ? matches.reduce((sum, item) => sum + item.price, 0) / matches.length : 0,
          volume: matches.reduce((sum, item) => sum + item.volume, 0),
          amount: totalAmount,
        }
      }).filter((item) => item.companyCount > 0)
    })
    const displaySectorLeaders = computed(() =>
      currentMarket.value === 'a' ? sectorLeaders.value : overseasThemeLeaders.value,
    )
    const visibleFundflow = computed(() => fundflowLeaders.value.slice(0, 10))
    const homeDigestAutoEnabled = computed(() => settingsStore.settings.ai.autoRun.homeDigest)
    const aiDigestTitle = computed(() => resolveAiDigestTitle(currentMarket.value))
    const flowRows = computed(() => {
      if (visibleFundflow.value.length) {
        return visibleFundflow.value.map((item, index) => ({
          rank: index + 1,
          code: item.code,
          name: item.name,
          metric: item.mainNetInflow,
          ratio: item.mainNetInflowPercent,
          ratioLabel: '净流入占比',
          copy: item.mainNetInflow >= 0 ? '主力净流入占优，优先看承接和跟风扩散。' : '主力净流出偏多，更多当作风险提醒看。',
        }))
      }

      const fallbackStocks = hotStocks.value.slice(0, 10)
      return fallbackStocks.map((item, index) => ({
        rank: index + 1,
        code: item.code,
        name: item.name,
        metric: item.amount,
        ratio: item.turnover || item.changePercent,
        ratioLabel: item.turnover ? '换手率' : '涨跌幅',
        copy: '主力资金榜缺失时，先用成交额与换手率判断当下最活跃的交易焦点。',
      }))
    })
    const sectorMoreAvailable = computed(() => marketStore.sectors.length > 12)
    const watchlistQuotes = computed(() =>
      marketStore.watchList.flatMap((item) => {
        const quote = marketStore.quotes.get(item.code)
        return quote ? [{ ...item, quote }] : []
      }),
    )
    const todayNewsItems = computed(() => {
      const today = formatLocalDateToken()
      const sample = newsStore.newsList.filter((item) => {
        if (item.publishTime) return item.publishTime.slice(0, 10) === today
        if (item.timestamp) return formatLocalDateToken(item.timestamp) === today
        return false
      })
      return sample.length ? sample : newsStore.newsList
    })
    const digestNewsItems = computed(() => {
      const sample = todayNewsItems.value.slice(0, 60)
      if (currentMarket.value === 'a') return sample

      const topNames = hotStocks.value.slice(0, 6).map((item) => item.name)
      const overseasKeywords =
        currentMarket.value === 'hk'
          ? ['港股', '恒生', '香港', '中概', '离岸人民币', ...topNames]
          : ['美股', '纳指', '道指', '标普', '美联储', '英伟达', '特斯拉', '苹果', '微软', '谷歌', '亚马逊', '中东', '伊朗', ...topNames]

      const filtered = sample.filter((item) => overseasKeywords.some((keyword) => buildNewsText(item).includes(keyword)))
      return filtered.length ? filtered : sample
    })
    const samplePositiveRatio = computed(() => {
      if (!hotStocks.value.length) return 0
      return (hotStocks.value.filter((item) => item.changePercent >= 0).length / hotStocks.value.length) * 100
    })
    const sampleNegativeRatio = computed(() => {
      if (!hotStocks.value.length) return 0
      return (hotStocks.value.filter((item) => item.changePercent < 0).length / hotStocks.value.length) * 100
    })
    const sampleAvgChange = computed(() => {
      if (!hotStocks.value.length) return 0
      return hotStocks.value.reduce((sum, item) => sum + item.changePercent, 0) / hotStocks.value.length
    })
    const sampleAvgAmount = computed(() => {
      if (!hotStocks.value.length) return 0
      return hotStocks.value.reduce((sum, item) => sum + item.amount, 0) / hotStocks.value.length
    })
    const sampleVolatileCount = computed(() => hotStocks.value.filter((item) => Math.abs(item.changePercent) >= 2).length)
    const sampleTopAmountShare = computed(() => computeTopAmountShare(hotStocks.value, 3))
    const leadIndex = computed(() => indices.value[0] || null)
    const secondIndex = computed(() => indices.value[1] || null)
    const thirdIndex = computed(() => indices.value[2] || null)
    const leadHotStock = computed(() => hotStocks.value[0] || null)
    const secondHotStock = computed(() => hotStocks.value[1] || null)
    const leadDisplaySector = computed(() => displaySectorLeaders.value[0] || null)
    const lagDisplaySector = computed(() => [...displaySectorLeaders.value].slice(-1)[0] || null)
    const latestDigestNews = computed(() => digestNewsItems.value[0] || null)
    const leadAiTheme = computed(() => aiDigest.value?.focusThemes?.[0] || null)
    const leadAiWatchStock = computed(() => aiDigest.value?.watchStocks?.[0] || null)
    const shortWatchStocks = computed(() => (aiDigest.value?.watchStocks || []).filter((item) => item.style === '短线'))
    const longWatchStocks = computed(() => (aiDigest.value?.watchStocks || []).filter((item) => item.style === '长线'))
    const breadthScore = computed(() => {
      if (currentMarket.value === 'a') {
        if (!adv.value.total) return 0
        return ((adv.value.advance - adv.value.decline) / adv.value.total) * 100
      }
      return (samplePositiveRatio.value - 50) * 2
    })

    const marketMood = computed(() => {
      if (currentMarket.value !== 'a') {
        const leadIndexChange = leadIndex.value?.changePercent ?? 0
        if (samplePositiveRatio.value >= 65 && sampleAvgChange.value >= 0.6 && leadIndexChange >= -0.3) return 'risk-on'
        if (samplePositiveRatio.value <= 40 || (sampleAvgChange.value <= -0.8 && leadIndexChange <= -0.8)) return 'risk-off'
        return 'balanced'
      }
      if (breadthScore.value > 20) return 'risk-on'
      if (breadthScore.value < -20) return 'risk-off'
      return 'balanced'
    })

    const aiPolicySectionTitle = computed(() => (currentMarket.value === 'a' ? 'AI政策导向' : 'AI国际催化'))

    const aiPolicyCards = computed(() =>
      (aiDigest.value?.focusThemes || []).slice(0, 4).map((item, index) => ({
        label: item.theme,
        summary: item.reason,
        catalyst: item.catalyst,
        tone: index === 0 ? 'active' : 'watch',
      })),
    )

    const aiOutlookCards = computed(() => {
      if (!aiDigest.value) return []

      const cards = [
        {
          label: '时段预判',
          value: aiDigest.value.futureOutlook || '等待 AI 输出',
          detail: aiDigest.value.summary,
        },
        {
          label: '短线关注',
          value: '短线',
          detail: aiDigest.value.shortTermView,
        },
        {
          label: '长线关注',
          value: '长线',
          detail: aiDigest.value.longTermView,
        },
      ]

      const stockCards = aiDigest.value.watchStocks.slice(0, 6).map((item, index) => ({
        label: `${item.style}标的 ${index + 1}`,
        value: `${item.name} ${item.code}`,
        detail: `入场 ${item.entryPrice}；退出 ${item.exitPrice}；${item.reason}`,
      }))

      const riskCards = (aiDigest.value.keyRisks || []).slice(0, 2).map((item, index) => ({
        label: `风险提醒 ${index + 1}`,
        value: '风险',
        detail: item,
      }))

      return [...cards, ...stockCards, ...riskCards]
    })

    const overviewCards = computed(() => {
      if (currentMarket.value !== 'a') {
        return [
          {
            label: '核心指数',
            value: leadIndex.value ? leadIndex.value.name : '--',
            detail: leadIndex.value ? `${formatPercent(leadIndex.value.changePercent)}% / 成交额 ${formatAmount(leadIndex.value.amount)}` : '等待指数同步',
            hint: '先确认海外主指数方向是否稳住。',
            range: '主指数向上时，更容易带动个股扩散；主指数转弱时，龙头也更容易反复。 ',
          },
          {
            label: '第二参考',
            value: secondIndex.value ? secondIndex.value.name : '--',
            detail: secondIndex.value ? `${formatPercent(secondIndex.value.changePercent)}% / 成交额 ${formatAmount(secondIndex.value.amount)}` : '等待补充指数同步',
            hint: '用第二指数确认风格是否扩散。',
            range: '主指数与第二指数同步走强，通常比单一指数独涨更稳。',
          },
          {
            label: '精选样本',
            value: `${hotStocks.value.length}`,
            detail: '首页当前载入的活跃样本数',
            hint: '先看最活跃的一批股票是否跟着指数走强。',
            range: '样本多不代表强，更重要的是头部能否持续放量并带动第二梯队。',
          },
          {
            label: '上涨覆盖',
            value: `${samplePositiveRatio.value.toFixed(0)}%`,
            detail: `${hotStocks.value.filter((item) => item.changePercent >= 0).length} / ${hotStocks.value.length || 0} 样本上涨`,
            hint: '看上涨是否只是龙头独强，还是已经扩散。',
            range: '60% 以上更像趋势推进，50% 附近说明分歧仍大。',
          },
          {
            label: '下跌覆盖',
            value: `${sampleNegativeRatio.value.toFixed(0)}%`,
            detail: `${hotStocks.value.filter((item) => item.changePercent < 0).length} / ${hotStocks.value.length || 0} 样本回落`,
            hint: '看活跃样本里是不是已经出现明显兑现压力。',
            range: '下跌覆盖升高时，要更重视主指数和龙头承接是否还稳。',
          },
          {
            label: '样本均值',
            value: `${sampleAvgChange.value >= 0 ? '+' : ''}${sampleAvgChange.value.toFixed(2)}%`,
            detail: '精选活跃股平均涨跌幅',
            hint: '看整体风险偏好是否扩散。',
            range: '均值持续为正时，龙头更容易带动第二梯队。',
          },
          {
            label: '剧烈波动',
            value: `${sampleVolatileCount.value}`,
            detail: '涨跌幅绝对值超过 2% 的样本数',
            hint: '看盘面是温和轮动，还是已经进入高波动阶段。',
            range: '波动样本越多，越要区分是真扩散还是高位分歧放大。',
          },
          {
            label: '焦点龙头',
            value: leadHotStock.value ? leadHotStock.value.name : '--',
            detail: leadHotStock.value ? `${formatPercent(leadHotStock.value.changePercent)}% / ${formatAmount(leadHotStock.value.amount)}` : '等待热点同步',
            hint: '优先跟踪最强资产的承接。',
            range: '放量领涨更可信，冲高回落说明资金还在试探。',
          },
          {
            label: '次强跟随',
            value: secondHotStock.value ? secondHotStock.value.name : '--',
            detail: secondHotStock.value ? `${formatPercent(secondHotStock.value.changePercent)}% / ${formatAmount(secondHotStock.value.amount)}` : '等待次强样本同步',
            hint: '看第二梯队是否愿意跟随龙头。',
            range: '只有次强股能跟出来，主线才更像真的在扩散。',
          },
          {
            label: '领跑主题',
            value: leadDisplaySector.value ? leadDisplaySector.value.name : '--',
            detail: leadDisplaySector.value
              ? `${formatPercent(leadDisplaySector.value.changePercent)}% / 领涨 ${leadDisplaySector.value.leadingStock || '待同步'}`
              : '等待主题热度同步',
            hint: '看哪条主线当前更容易聚焦资金。',
            range: '主题强度和龙头强度一起上升时，更容易走成连续主线。',
          },
          {
            label: '承压主题',
            value: lagDisplaySector.value ? lagDisplaySector.value.name : '--',
            detail: lagDisplaySector.value
              ? `${formatPercent(lagDisplaySector.value.changePercent)}% / 观察 ${lagDisplaySector.value.leadingStock || '代表股'}`
              : '等待弱势主题同步',
            hint: '看资金是否正在从某些方向撤出。',
            range: '最弱主题持续走弱时，往往会拖累同风格的次强股。',
          },
          {
            label: '成交均值',
            value: sampleAvgAmount.value ? formatAmount(sampleAvgAmount.value) : '--',
            detail: '精选样本平均成交额',
            hint: '看资金是否愿意持续参与。',
            range: '成交额持续抬升时，主线延续性通常更好。',
          },
          {
            label: '量能集中',
            value: `${sampleTopAmountShare.value.toFixed(0)}%`,
            detail: '前三活跃样本占整体成交额比重',
            hint: '看资金是集中抱团，还是已经开始向更多标的扩散。',
            range: '占比越高越像抱团驱动，占比回落说明扩散范围在变大。',
          },
          {
            label: '消息温度',
            value: newsSentiment.value.label,
            detail: newsSentiment.value.hint,
            hint: '看海外消息是否继续偏暖。',
            range: '偏暖有利于科技成长，中性更看轮动，偏谨慎先控节奏。',
          },
          {
            label: '指数协同',
            value: leadIndex.value && secondIndex.value ? `${formatPercent(leadIndex.value.changePercent)} / ${formatPercent(secondIndex.value.changePercent)}%` : '--',
            detail: thirdIndex.value ? `${thirdIndex.value.name} ${formatPercent(thirdIndex.value.changePercent)}%` : '等待第三观察锚点同步',
            hint: '看主指数之外是否有第二、第三指数同步跟进。',
            range: '多指数共振比单点独强更利于后续卡片和个股持续走出来。',
          },
          {
            label: '消息脉冲',
            value: latestDigestNews.value?.source || '等待同步',
            detail: latestDigestNews.value?.title || '当前还没有拿到更贴近港美股主题的快讯。',
            hint: '看最新消息是不是正在强化当前主线。',
            range: '快讯要和指数、主题、龙头一起共振，才更值得提高优先级。',
          },
          {
            label: '关注池表现',
            value: watchlistQuotes.value.length
              ? `${watchlistQuotes.value.reduce((sum, item) => sum + item.quote.changePercent, 0) / watchlistQuotes.value.length >= 0 ? '+' : ''}${(watchlistQuotes.value.reduce((sum, item) => sum + item.quote.changePercent, 0) / watchlistQuotes.value.length).toFixed(2)}%`
              : '--',
            detail: watchlistQuotes.value.length ? `${watchlistQuotes.value.length} 只关注股实时均值` : '还没有关注标的',
            hint: '看自己的观察池是否跟上市场主线。',
            range: '强于主指数说明选股方向更对。',
          },
        ]
      }

      const upRatio = adv.value.total ? (adv.value.advance / adv.value.total) * 100 : 0
      const riseFallRatio = adv.value.decline ? adv.value.advance / adv.value.decline : adv.value.advance
      const avgTurnover = hotStocks.value.length
        ? hotStocks.value.reduce((sum, item) => sum + (item.turnover || 0), 0) / hotStocks.value.length
        : 0
      const topSector = sectorLeaders.value[0]
      const hotLeader = hotStocks.value[0]
      const hotPositiveRatio = hotStocks.value.length
        ? (hotStocks.value.filter((item) => item.changePercent > 0).length / hotStocks.value.length) * 100
        : 0
      const positiveFlowRatio = visibleFundflow.value.length
        ? (visibleFundflow.value.filter((item) => item.mainNetInflow > 0).length / visibleFundflow.value.length) * 100
        : hotPositiveRatio
      const watchAvgChange = watchlistQuotes.value.length
        ? watchlistQuotes.value.reduce((sum, item) => sum + item.quote.changePercent, 0) / watchlistQuotes.value.length
        : 0
      const indexSpread = leadIndex.value && secondIndex.value ? Math.abs(leadIndex.value.changePercent - secondIndex.value.changePercent) : 0

      return [
        {
          label: '上涨占比',
          value: `${upRatio.toFixed(1)}%`,
          tone: upRatio >= 60 ? 'up' : upRatio >= 50 ? 'flat' : 'down',
          detail: `上涨 ${adv.value.advance} 家 / 下跌 ${adv.value.decline} 家`,
          hint: '看市场是否普涨。',
          range: '50% 以上偏稳，60% 以上偏强，45% 以下要谨慎。',
        },
        {
          label: '涨跌家数比',
          value: riseFallRatio ? riseFallRatio.toFixed(2) : '--',
          tone: riseFallRatio >= 1.3 ? 'up' : riseFallRatio >= 0.8 ? 'flat' : 'down',
          detail: '上涨家数 ÷ 下跌家数',
          hint: '看赚钱效应是否扩散。',
          range: '1 附近均衡，1.3 以上更强，0.8 以下偏弱。',
        },
        {
          label: '热点换手',
          value: avgTurnover ? `${avgTurnover.toFixed(2)}%` : '--',
          tone: avgTurnover >= 3 && avgTurnover <= 8 ? 'flat' : avgTurnover > 8 ? 'hot' : 'down',
          detail: '首页活跃股平均换手',
          hint: '看热点资金是否愿意反复博弈。',
          range: '3%-8% 偏健康，过低说明关注度弱，过高要防冲高回落。',
        },
        {
          label: '主线板块',
          value: topSector ? topSector.name : '--',
          tone: topSector && topSector.changePercent >= 0 ? 'up' : 'down',
          detail: topSector ? `${formatPercent(topSector.changePercent)}% / 领涨 ${topSector.leadingStock || '待同步'}` : '等待板块热度同步',
          hint: '看资金抱团的主方向。',
          range: '涨幅和成交额同时靠前，持续性更好。',
        },
        {
          label: '焦点龙头',
          value: hotLeader ? hotLeader.name : '--',
          tone: hotLeader && hotLeader.changePercent >= 0 ? 'up' : 'down',
          detail: hotLeader ? `${formatPercent(hotLeader.changePercent)}% / 成交额 ${formatAmount(hotLeader.amount)}` : '等待活跃股同步',
          hint: '看市场是否愿意围绕龙头扩散。',
          range: '放量领涨更强，缩量冲高更容易反复。',
        },
        {
          label: '指数协同',
          value: leadIndex.value && secondIndex.value ? `${formatPercent(leadIndex.value.changePercent)} / ${formatPercent(secondIndex.value.changePercent)}%` : '--',
          tone: indexSpread <= 1 ? 'up' : 'flat',
          detail: leadIndex.value && secondIndex.value ? `${leadIndex.value.name} 与 ${secondIndex.value.name} 的强弱差 ${indexSpread.toFixed(2)} 个点` : '等待指数补齐后再看协同',
          hint: '看指数之间是共振，还是只有单一指数独强。',
          range: '多个核心指数同步上行更稳，强弱差过大通常说明结构分化依旧明显。',
        },
        {
          label: '消息温度',
          value: newsSentiment.value.label,
          tone: newsSentiment.value.tone === 'positive' ? 'up' : newsSentiment.value.tone === 'negative' ? 'down' : 'flat',
          detail: newsSentiment.value.hint,
          hint: '看消息面整体更偏利多还是利空。',
          range: '偏暖利于主线延续，中性看轮动，偏谨慎要先控回撤。',
        },
        {
          label: '资金偏暖率',
          value: (visibleFundflow.value.length || hotStocks.value.length) ? `${positiveFlowRatio.toFixed(0)}%` : '--',
          tone: positiveFlowRatio >= 60 ? 'up' : positiveFlowRatio >= 40 ? 'flat' : 'down',
          detail: visibleFundflow.value.length ? `${fundflowSummary.value.positiveCount} / ${visibleFundflow.value.length} 主力净流入` : hotStocks.value.length ? `活跃股上涨占比（主力数据暂缺）` : '等待主力资金榜同步',
          hint: '看主力资金是在做多还是撤退。',
          range: '60% 以上偏强，50% 附近分歧大，40% 以下偏弱。',
        },
        {
          label: '关注池表现',
          value: watchlistQuotes.value.length ? `${watchAvgChange >= 0 ? '+' : ''}${watchAvgChange.toFixed(2)}%` : '--',
          tone: watchAvgChange >= 0.5 ? 'up' : watchAvgChange <= -0.5 ? 'down' : 'flat',
          detail: watchlistQuotes.value.length ? `${watchlistQuotes.value.length} 只关注股实时均值` : '还没有关注标的',
          hint: '看自己盯盘的股票整体状态。',
          range: '强于大盘说明选股还在主线，弱于大盘要及时复盘。',
        },
      ]
    })

    const pulseCards = computed(() => {
      if (currentMarket.value !== 'a') {
        const risingCount = hotStocks.value.filter((item) => item.changePercent >= 0).length
        const fallingCount = hotStocks.value.filter((item) => item.changePercent < 0).length
        return [
          {
            label: '上涨 / 下跌样本',
            value: `${risingCount} / ${fallingCount}`,
            hint: `上涨覆盖 ${samplePositiveRatio.value.toFixed(0)}%，下跌覆盖 ${sampleNegativeRatio.value.toFixed(0)}%`,
            description: '直接看首页活跃样本里上涨和下跌的数量对比，先确认海外市场是否出现明确扩散。',
            range: '上涨样本明显高于下跌样本时，更容易走成趋势；若只是少数龙头硬撑，数量对比不会持续改善。',
            tone: marketMood.value,
          },
          {
            label: '领涨指数',
            value: leadIndex.value ? `${leadIndex.value.name} ${formatPercent(leadIndex.value.changePercent)}%` : '--',
            hint: '当前最核心的海外指数方向',
            description: '先看主指数有没有把市场方向带起来，港股盯恒指/科技指数，美股盯道指/纳指/标普的同步情况。',
            range: '指数翻红但量能弱时，更像修复；指数和龙头一起强，主线延续概率更高。',
            tone: leadIndex.value && leadIndex.value.changePercent >= 0 ? 'risk-on' : 'risk-off',
          },
          {
            label: '样本均值',
            value: `${sampleAvgChange.value >= 0 ? '+' : ''}${sampleAvgChange.value.toFixed(2)}%`,
            hint: '当前活跃样本平均涨跌幅',
            description: '看今天最活跃的一批港股/美股到底是整体抬升，还是只有少数龙头独涨。',
            range: '均值持续为正说明龙头外还有扩散；均值为负而龙头独强，多半是结构分化而不是全面转强。',
            tone: sampleAvgChange.value >= 0 ? 'risk-on' : 'risk-off',
          },
          {
            label: '成交脉冲',
            value: sampleAvgAmount.value ? formatAmount(sampleAvgAmount.value) : '--',
            hint: '活跃样本平均成交额',
            description: '用平均成交额快速感受海外热点股有没有得到真资金参与，而不是只看价格波动。',
            range: '成交额越大，代表资金参与越深；但若只集中在一两只龙头，也要防抱团后的回落。',
            tone: 'balanced',
          },
          {
            label: '量能集中',
            value: `${sampleTopAmountShare.value.toFixed(0)}%`,
            hint: '前三活跃样本占整体成交比重',
            description: '看资金是只抱团龙头，还是已经开始往第二梯队和更多主题扩散。',
            range: '占比过高说明抱团明显，占比回落同时样本均值走强，往往代表扩散更健康。',
            tone: sampleTopAmountShare.value >= 65 ? 'risk-off' : 'balanced',
          },
          {
            label: '消息脉冲',
            value: latestDigestNews.value?.source || '--',
            hint: latestDigestNews.value?.title || '等待更贴近当前主线的当日消息',
            description: '直接显示当前最贴近港美股主线的一条消息源，用来看催化是不是正在强化盘面。',
            range: '消息本身不是结论，关键看它能否和指数、主题、龙头一起共振。',
            tone: 'balanced',
          },
        ]
      }

      return [
        {
          label: '上涨 / 下跌',
          value: `${adv.value.advance} / ${adv.value.decline}`,
          hint: `平盘 ${adv.value.flat} 家，总计 ${adv.value.total} 家`,
          description: '把市场里上涨和下跌股票的数量直接放到首页头部，替代抽象温度分数，更方便盘中判断扩散强弱。',
          range: '上涨家数持续明显高于下跌家数时，盘面更像普涨推进；若两者接近或下跌反超，就要防止热点分化。',
          tone: marketMood.value,
        },
        {
          label: '领涨指数',
          value: leadIndex.value ? `${leadIndex.value.name} ${formatPercent(leadIndex.value.changePercent)}%` : '--',
          hint: '当前最强核心指数',
          description: '先看哪条核心指数在领方向，判断市场是权重主导、成长主导，还是只剩局部修复。',
          range: '指数放量上行时更能确认方向；指数微涨但龙头冲高回落，说明情绪并不稳。',
          tone: leadIndex.value && leadIndex.value.changePercent >= 0 ? 'risk-on' : 'risk-off',
        },
        {
          label: '热点均值',
          value: `${sampleAvgChange.value >= 0 ? '+' : ''}${sampleAvgChange.value.toFixed(2)}%`,
          hint: '首页热点股平均涨跌幅',
          description: '用热点样本均值判断今天的赚钱效应是不是从龙头扩散到了更多强势股。',
          range: '均值明显为正且换手健康，说明扩散更顺；均值为负而龙头独强，容易转成分化行情。',
          tone: sampleAvgChange.value >= 0 ? 'risk-on' : 'risk-off',
        },
        {
          label: '成交脉冲',
          value: formatAmount(adv.value.totalAmount),
          hint: '全市场成交额',
          description: '成交额决定行情有没有资金基础，AI 盘中判断也会优先拿它来确认上午和下午的强弱。',
          range: '成交额持续放大，主线更容易延续；缩量反弹通常偏修复，量价背离时要防回落。',
          tone: 'balanced',
        },
        {
          label: '主线板块',
          value: sectorLeaders.value[0]?.name || '--',
          hint: sectorLeaders.value[0]?.leadingStock ? `领涨 ${sectorLeaders.value[0].leadingStock}` : '等待板块同步',
          description: '把当前热度最高的板块直接提到首页头部，便于盘中快速锁定主线。',
          range: '板块涨幅、成交额和龙头表现同步抬升时，更接近真实主线；只有单股硬拉时持续性一般。',
          tone: sectorLeaders.value[0] && sectorLeaders.value[0].changePercent >= 0 ? 'risk-on' : 'risk-off',
        },
        {
          label: 'AI焦点',
          value: leadAiTheme.value?.theme || leadAiWatchStock.value?.name || '--',
          hint: leadAiTheme.value?.reason || leadAiWatchStock.value?.reason || '等待 AI 结合消息面、政策面和国际消息完成评估',
          description: '这里不再展示本地预设结论，只显示当前 AI 评估出的第一焦点主题或候选标的。',
          range: '只有当 AI 已拿到盘面、快讯、政策和国际消息后，这里的焦点才有参考价值；未评估前保持空位。',
          tone: aiDigest.value ? 'balanced' : 'risk-off',
        },
        {
          label: '主力偏暖率',
          value: visibleFundflow.value.length ? `${((visibleFundflow.value.filter((item) => item.mainNetInflow >= 0).length / visibleFundflow.value.length) * 100).toFixed(0)}%` : '--',
          hint: visibleFundflow.value.length ? `TOP${visibleFundflow.value.length} 中偏暖占比` : '等待主力资金同步',
          description: '看主力资金榜前排里有多少还在净流入，快速判断资金今天是继续做多还是偏撤退。',
          range: '60% 以上更偏强，50% 左右代表分歧，低于 40% 时更要防止热点回落。',
          tone: 'balanced',
        },
        {
          label: '国际消息',
          value: latestDigestNews.value?.source || '等待同步',
          hint: latestDigestNews.value?.title || '等待当日国际与宏观快讯',
          description: '把最新一条更贴近国际市场和宏观环境的快讯提到首页，方便快速确认外部催化是否在影响盘面。',
          range: '外部消息只有和指数、板块、龙头一起共振时才值得提高优先级，孤立消息更多当成观察项。',
          tone: 'balanced',
        },
      ]
    })

    const newsSentiment = computed(() => {
      const sample = digestNewsItems.value.slice(0, 8)
      if (!sample.length) {
        return {
          label: '等待同步',
          hint: '新闻源还没返回足够样本',
          tone: 'balanced',
        }
      }
      const positiveKeywords = ['增长', '回购', '合作', '签署', '突破', '上调', '新高', '增持', '利好']
      const negativeKeywords = ['下滑', '减持', '风险', '处罚', '开板', '跌停', '下调', '亏损', '承压']
      let score = 0
      for (const item of sample) {
        const text = `${item.title} ${item.content || ''}`
        if (positiveKeywords.some((keyword) => text.includes(keyword))) score += 1
        if (negativeKeywords.some((keyword) => text.includes(keyword))) score -= 1
      }
      if (score >= 2) {
        return { label: '偏暖', hint: '近期消息更偏利多与合作扩张', tone: 'risk-on' }
      }
      if (score <= -2) {
        return { label: '偏谨慎', hint: '近期消息里风险与压力词更多', tone: 'risk-off' }
      }
      return { label: '中性', hint: '消息面没有形成单边倾向', tone: 'balanced' }
    })

    const fundflowSummary = computed(() => {
      const sample = fundflowLeaders.value.slice(0, 10)
      const positive = sample.filter((item) => item.mainNetInflow > 0)
      const total = sample.reduce((sum, item) => sum + item.mainNetInflow, 0)
      return {
        positiveCount: positive.length,
        totalNetInflow: total,
        leaders: positive.slice(0, 3).map((item) => item.name).join('、') || sample.slice(0, 2).map((item) => item.name).join('、'),
      }
    })

    async function loadFundflow() {
      if (currentMarket.value !== 'a') {
        fundflowLeaders.value = []
        return
      }
      const market = currentMarket.value
      try {
        const res = await get<{ data: FundFlow[] }>('/api/fundflow/rank?limit=18')
        if (currentMarket.value !== market) return
        const nextData = res.data ?? []
        if (nextData.length || !fundflowLeaders.value.length) {
          fundflowLeaders.value = nextData
        }
        if (nextData.length) {
          fundflowUpdatedAt.value = Date.now()
        }
      } catch (error) {
        console.error('Failed to load fund flow:', error)
      }
    }

    async function requestDigest(force = false) {
      if (!force && !homeDigestAutoEnabled.value) return
      if (aiDigestLoading.value) return
      const now = Date.now()
      if (!force && now - lastDigestAt.value < settingsStore.settings.ai.autoRunInterval * 1000) return
      lastDigestAt.value = now
      if (force) {
        digestPolling.stop()
      }
      await refreshDigest()
    }

    let homeAiTaskId: string | null = null

    function cancelHomeAiDigest() {
      if (homeAiTaskId) {
        aiTaskLogger.cancelTask(homeAiTaskId)
        aiDigestLoading.value = false
        homeAiTaskId = null
      }
    }

    function isStaleHomeLoad(seq: number, market: MarketType) {
      return seq !== homeLoadSeq.value || market !== currentMarket.value
    }

    async function loadDashboardDeferred(seq: number, market: MarketType) {
      const tasks: Promise<unknown>[] = []
      const trackedCodes = marketStore.watchList.map((item) => item.code)
      secondaryLoading.value = true

      tasks.push(newsStore.fetchNews({ limit: HOME_NEWS_LIMIT, maxAgeMs: HOME_SECONDARY_CACHE_TTL_MS }))
      if (trackedCodes.length) {
        tasks.push(marketStore.fetchQuotes(trackedCodes))
      }
      if (market === 'a') {
        if (!marketStore.hasFreshSnapshotData('a', 'advanceDecline', HOME_PRIMARY_CACHE_TTL_MS)) {
          tasks.push(marketStore.fetchAdvanceDecline())
        }
        if (!marketStore.hasFreshSnapshotData('a', 'sectors', HOME_SECONDARY_CACHE_TTL_MS)) {
          tasks.push(marketStore.fetchSectors('industry'))
        }
        if (Date.now() - fundflowUpdatedAt.value >= HOME_SECONDARY_CACHE_TTL_MS) {
          tasks.push(loadFundflow())
        }
      } else {
        fundflowLeaders.value = []
      }

      await Promise.allSettled(tasks)
      if (isStaleHomeLoad(seq, market)) return
      secondaryLoading.value = false
      if (homeDigestAutoEnabled.value && isTradingSession.value) {
        void requestDigest()
      }
    }

    async function loadDashboard(forceStocks = false) {
      const seq = homeLoadSeq.value + 1
      homeLoadSeq.value = seq
      const market = currentMarket.value
      const pageSize = HOME_STOCK_PAGE_SIZES[market]
      const shouldFetchIndices = !marketStore.hasFreshSnapshotData(market, 'indices', HOME_PRIMARY_CACHE_TTL_MS)
      const shouldFetchStocks = forceStocks || !marketStore.hasFreshSnapshotData(market, 'stockList', HOME_PRIMARY_CACHE_TTL_MS)
      const primaryTasks: Promise<unknown>[] = []

      dashboardLoading.value = !marketStore.hasPrimarySnapshot(market)
      if (shouldFetchIndices) {
        primaryTasks.push(marketStore.fetchIndices(market))
      }
      if (shouldFetchStocks) {
        primaryTasks.push(marketStore.fetchStockList(market, 1, pageSize))
      }

      if (primaryTasks.length) {
        await Promise.allSettled(primaryTasks)
      }

      if (isStaleHomeLoad(seq, market)) return
      dashboardLoading.value = false
      void loadDashboardDeferred(seq, market)
    }

    function switchMarket(market: MarketType) {
      currentMarket.value = market
      aiDigest.value = null
      aiDigestError.value = ''
      lastDigestAt.value = 0
      marketStore.clearMarketData(market)
      void loadDashboard()
    }

    function navigateToStock(code: string) {
      router.push({ name: 'stockDetail', params: { code } })
    }

    function formatNewsTime(timeStr: string) {
      if (!timeStr) return ''
      return timeStr.slice(5, 16)
    }

    async function loadRecommendationCandidates() {
      const codes = uniqueCodes([
        ...hotStocks.value.slice(0, 12).map((item) => item.code),
        ...watchlistQuotes.value.slice(0, 8).map((item) => item.code),
        ...visibleFundflow.value.slice(0, 8).map((item) => item.code),
      ])

      if (codes.length < 6) {
        throw new Error(`实时推荐候选不足，当前仅 ${codes.length} 只，已禁止生成股票建议`)
      }

      await marketStore.fetchQuotes(codes)

      if (!marketStore.quotesUpdatedAt || Date.now() - marketStore.quotesUpdatedAt > HOME_RECOMMENDATION_QUOTE_MAX_AGE_MS) {
        throw new Error('实时报价已过期，已禁止生成股票建议')
      }

      const hotMap = new Map(hotStocks.value.map((item) => [item.code, item]))
      const watchMap = new Map(watchlistQuotes.value.map((item) => [item.code, item]))
      const fundflowMap = new Map(visibleFundflow.value.map((item) => [item.code, item]))

      const candidates = codes.flatMap((code) => {
        const quote = marketStore.quotes.get(code)
        if (!quote?.timestamp) return []
        const quoteAgeMs = Date.now() - quote.timestamp
        if (quoteAgeMs > HOME_RECOMMENDATION_QUOTE_MAX_AGE_MS) return []

        const hot = hotMap.get(code)
        const watch = watchMap.get(code)
        const flow = fundflowMap.get(code)
        return [{
          code,
          name: quote.name || hot?.name || watch?.name || flow?.name || code,
          latestPrice: quote.price,
          changePercent: quote.changePercent,
          amount: quote.amount || hot?.amount || 0,
          turnover: quote.turnover || hot?.turnover || 0,
          source: (hot ? 'hot' : watch ? 'watchlist' : 'fundflow') as 'hot' | 'watchlist' | 'fundflow',
          quoteTimestamp: quote.timestamp,
          quoteAgeMs,
        }]
      })

      if (candidates.length < 6) {
        throw new Error(`带实时价格的推荐候选不足，当前仅 ${candidates.length} 只，已禁止生成股票建议`)
      }

      return candidates
    }

    async function refreshDigest() {
      if (!settingsStore.isAiProviderConfigured(settingsStore.activeProvider)) {
        aiDigestError.value = '当前未配置 AI 模型，无法生成首页市场点评。'
        aiDigestLoading.value = false
        return
      }
      const task = aiTaskLogger.createTask('AI市场点评', 'home')
      homeAiTaskId = task.id
      aiDigestLoading.value = true
      aiDigestError.value = ''
      aiTaskLogger.addLog(task.id, '开始收集盘面数据...')

      try {
        aiTaskLogger.addLog(task.id, `当前市场：${currentMarket.value === 'a' ? 'A股' : currentMarket.value === 'hk' ? '港股' : '美股'}，正在构建分析输入...`)
        aiTaskLogger.addLog(task.id, '正在刷新推荐候选股的实时价格...')
        const recommendationCandidates = await loadRecommendationCandidates()

        aiTaskLogger.addLog(task.id, '正在调用AI模型生成点评...')
        const marketSession = getMarketSessionContext(currentMarket.value)
        aiDigest.value = await generateDigest(settingsStore.activeProvider, {
          title: aiDigestTitle.value,
          market: currentMarket.value,
          currentTime: new Date().toLocaleString('zh-CN', { timeZone: marketSession.timezone, hour12: false }),
          snapshot: {
            marketLabel: marketSession.marketLabel,
            dataFreshness: {
              stockListUpdatedAt: marketStore.stockListUpdatedAt,
              quotesUpdatedAt: marketStore.quotesUpdatedAt,
              newsUpdatedAt: newsStore.lastUpdated,
            },
            breadth: currentMarket.value === 'a'
              ? {
                advance: adv.value.advance,
                decline: adv.value.decline,
                flat: adv.value.flat,
                total: adv.value.total,
                totalAmount: adv.value.totalAmount,
              }
              : undefined,
            indices: indices.value.slice(0, 5).map((item) => ({
              code: item.code,
              name: item.name,
              price: item.price,
              changePercent: item.changePercent,
              amount: item.amount,
            })),
            sectors: displaySectorLeaders.value.slice(0, 8).map((item) => ({
              name: item.name,
              changePercent: item.changePercent,
              amount: item.amount || 0,
              leadingStock: item.leadingStock || '',
            })),
            hotStocks: hotStocks.value.slice(0, 12).map((item) => ({
              code: item.code,
              name: item.name,
              price: item.price,
              changePercent: item.changePercent,
              amount: item.amount,
              turnover: item.turnover || 0,
              sectorTags: item.sectorTags || [],
            })),
            fundFlows: visibleFundflow.value.slice(0, 8).map((item) => ({
              code: item.code,
              name: item.name,
              mainNetInflow: item.mainNetInflow,
              mainNetInflowPercent: item.mainNetInflowPercent,
            })),
            watchlist: watchlistQuotes.value.slice(0, 8).map((item) => ({
              code: item.code,
              name: item.name,
              price: item.quote.price,
              changePercent: item.quote.changePercent,
            })),
            recommendationCandidates,
            facts: [
              currentMarket.value === 'a'
                ? `上涨 ${adv.value.advance} 家，下跌 ${adv.value.decline} 家，平盘 ${adv.value.flat} 家，总成交额 ${formatAmount(adv.value.totalAmount)}`
                : `活跃样本上涨 ${hotStocks.value.filter((item) => item.changePercent >= 0).length} 只，下跌 ${hotStocks.value.filter((item) => item.changePercent < 0).length} 只，样本均值 ${sampleAvgChange.value >= 0 ? '+' : ''}${sampleAvgChange.value.toFixed(2)}%`,
              `推荐候选已刷新 ${recommendationCandidates.length} 只，最新报价同步时间 ${new Date(marketStore.quotesUpdatedAt).toLocaleTimeString('zh-CN', { hour12: false })}`,
              leadIndex.value ? `${leadIndex.value.name} ${formatPercent(leadIndex.value.changePercent)}%，成交额 ${formatAmount(leadIndex.value.amount)}` : '核心指数等待同步',
              secondIndex.value ? `${secondIndex.value.name} ${formatPercent(secondIndex.value.changePercent)}%` : '第二指数等待同步',
              displaySectorLeaders.value[0]
                ? `当前靠前主题 ${displaySectorLeaders.value[0].name}，代表股 ${displaySectorLeaders.value[0].leadingStock || '待同步'}`
                : '热点主题等待同步',
              hotStocks.value[0]
                ? `活跃股票 ${hotStocks.value[0].name}(${hotStocks.value[0].code}) 当前 ${formatPrice(hotStocks.value[0].price)}，涨跌幅 ${formatPercent(hotStocks.value[0].changePercent)}%`
                : '活跃股票等待同步',
              visibleFundflow.value[0]
                ? `主力资金靠前 ${visibleFundflow.value[0].name}(${visibleFundflow.value[0].code}) 净流入 ${formatAmount(visibleFundflow.value[0].mainNetInflow)}`
                : '主力资金榜等待同步',
            ],
          },
          financialNews: digestNewsItems.value.slice(0, 24).map((item) => ({
            title: item.title,
            source: item.source || '快讯',
            publishTime: item.publishTime || '',
            content: item.content || '',
          })),
        }, {
          abortSignal: task.abortController?.signal,
          onProgress: (step) => {
            aiTaskLogger.addProgressLog(task.id, step)
          },
        })

        if (aiTaskLogger.isTaskCancelled(task.id)) {
          aiTaskLogger.addLog(task.id, '评估已被取消', 'warn')
          aiDigestLoading.value = false
          homeAiTaskId = null
          return
        }

        aiTaskLogger.addLog(task.id, 'AI点评生成完成', 'success')
        aiTaskLogger.completeTask(task.id, true)
      } catch (error) {
        if (aiTaskLogger.isTaskCancelled(task.id)) {
          aiTaskLogger.addLog(task.id, '评估已被取消', 'warn')
        } else {
          const msg = error instanceof Error ? error.message : String(error)
          aiDigestError.value = msg
          aiDigest.value = null
          aiTaskLogger.addLog(task.id, `评估失败：${msg}`, 'error')
          aiTaskLogger.completeTask(task.id, false, msg)
        }
      } finally {
        aiDigestLoading.value = false
        homeAiTaskId = null
      }
    }

    const heroPolling = useRealtimeTask(async () => {
      if (!isTradingSession.value) return
      await marketStore.fetchIndices(currentMarket.value)
      const trackedCodes = marketStore.watchList.map((item) => item.code)
      if (trackedCodes.length) {
        await marketStore.fetchQuotes(trackedCodes)
      }
    }, {
      intervalMultiplier: 1,
      immediate: false,
      minimumMs: 5000,
      pauseWhenHidden: true,
      market: () => realtimeMarket.value,
      skipWhenMarketClosed: true,
    })

    const newsPolling = useRealtimeTask(async () => {
      await newsStore.fetchNews({ limit: HOME_NEWS_LIMIT, maxAgeMs: 15_000 })
    }, { intervalMultiplier: 2, immediate: false, minimumMs: 20000, pauseWhenHidden: true })

    const secondaryPolling = useRealtimeTask(async () => {
      if (!isTradingSession.value) return
      const market = currentMarket.value
      await marketStore.fetchStockList(market, 1, HOME_STOCK_PAGE_SIZES[market])
      if (currentMarket.value !== market) return
      if (market === 'a') {
        const tasks: Promise<unknown>[] = [marketStore.fetchAdvanceDecline()]
        if (!marketStore.hasFreshSnapshotData('a', 'sectors', HOME_SECONDARY_CACHE_TTL_MS)) {
          tasks.push(marketStore.fetchSectors('industry'))
        }
        if (Date.now() - fundflowUpdatedAt.value >= HOME_SECONDARY_CACHE_TTL_MS) {
          tasks.push(loadFundflow())
        }
        await Promise.all(tasks)
      }
    }, {
      intervalMultiplier: 1,
      immediate: false,
      minimumMs: 12000,
      pauseWhenHidden: true,
      market: () => realtimeMarket.value,
      skipWhenMarketClosed: true,
    })

    const digestPolling = useRealtimeTask(async () => {
      if (!isTradingSession.value) return
      await requestDigest()
    }, {
      enabled: () => homeDigestAutoEnabled.value,
      immediate: false,
      intervalSource: 'ai',
      intervalMultiplier: 1,
      minimumMs: 10000,
      pauseWhenHidden: true,
      market: () => realtimeMarket.value,
      skipWhenMarketClosed: true,
    })

    onMounted(async () => {
      await loadDashboard(true)
      heroPolling.start()
      newsPolling.start(false)
      secondaryPolling.start()
      digestPolling.start(false)
    })

    onActivated(() => {
      void loadDashboard()
      heroPolling.start()
      newsPolling.start(false)
      secondaryPolling.start()
      digestPolling.start(false)
    })

    onDeactivated(() => {
      heroPolling.stop()
      newsPolling.stop()
      secondaryPolling.stop()
      digestPolling.stop()
    })

    return {
      currentMarket,
      indexExpanded,
      sectorExpanded,
      aiDigest,
      aiDigestError,
      aiDigestLoading,
      dashboardLoading,
      secondaryLoading,
      marketTabs,
      indices,
      visibleIndices,
      adv,
      hotStocks,
      sectorLeaders,
      displaySectorLeaders,
      fundflowLeaders,
      visibleFundflow,
      flowRows,
      sectorMoreAvailable,
      watchlistQuotes,
      todayNewsItems,
      pulseCards,
      overviewCards,
      aiDigestTitle,
      aiPolicySectionTitle,
      aiPolicyCards,
      aiOutlookCards,
      shortWatchStocks,
      longWatchStocks,
      newsSentiment,
      marketMood,
      fundflowSummary,
      homeDigestAutoEnabled,
      heroPolling,
      heroRealtimeActive,
      formatPrice,
      formatPercent,
      formatVolume,
      formatAmount,
      formatNewsTime,
      switchMarket,
      navigateToStock,
      requestDigest,
      cancelHomeAiDigest,
      newsStore,
    }
  },
})
