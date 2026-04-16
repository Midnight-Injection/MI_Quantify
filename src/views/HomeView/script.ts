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

interface PolicyThemePreset {
  label: string
  keywords: string[]
  beneficiary: string
  caution: string
  sectorKeywords: string[]
}

interface OverseasThemePreset {
  title: string
  symbols: string[]
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

const POLICY_THEME_PRESETS: PolicyThemePreset[] = [
  {
    label: '科技自主',
    keywords: ['算力', '芯片', '半导体', '人工智能', '信创', '国产替代', '服务器'],
    beneficiary: '算力、半导体、软件自主',
    caution: '高位题材容易日内大波动',
    sectorKeywords: ['半导体', '电子', '软件', '通信', '算力', '人工智能'],
  },
  {
    label: '稳增长 / 基建',
    keywords: ['基建', '专项债', '稳增长', '水利', '铁路', '城建', '工程'],
    beneficiary: '基建链、工程机械、央国企',
    caution: '更依赖政策持续兑现',
    sectorKeywords: ['基建', '建筑', '工程', '建材', '机械', '水泥'],
  },
  {
    label: '消费修复',
    keywords: ['消费', '零售', '汽车', '家电', '旅游', '餐饮', '补贴'],
    beneficiary: '消费、汽车、家电、旅游',
    caution: '业绩兑现弱时持续性会打折',
    sectorKeywords: ['消费', '零售', '汽车', '家电', '旅游', '食品'],
  },
  {
    label: '高端制造 / 新能源',
    keywords: ['机器人', '制造', '新能源', '光伏', '储能', '风电', '工业母机'],
    beneficiary: '设备、储能、先进制造',
    caution: '订单与出口节奏变化会影响预期',
    sectorKeywords: ['新能源', '光伏', '储能', '电池', '机器人', '制造'],
  },
  {
    label: '地产与金融协同',
    keywords: ['地产', '房地产', '楼市', '按揭', '降准', '银行', '券商'],
    beneficiary: '地产链、银行、券商、保险',
    caution: '政策若不连续，反弹更容易偏交易化',
    sectorKeywords: ['房地产', '银行', '券商', '保险', '多元金融'],
  },
  {
    label: '资源涨价 / 通胀链',
    keywords: ['原油', '煤炭', '铜', '黄金', '有色', '化工', '涨价'],
    beneficiary: '油气、有色、煤炭、化工',
    caution: '价格脉冲快，但高位回撤也更急',
    sectorKeywords: ['有色', '煤炭', '石油', '化工', '黄金'],
  },
  {
    label: '医药创新',
    keywords: ['医药', '创新药', '医保', '器械', '药审', '生物科技'],
    beneficiary: '创新药、医疗器械、CXO',
    caution: '业绩和审评消息会放大分化',
    sectorKeywords: ['医药', '医疗', '生物', '器械'],
  },
  {
    label: '农业与粮食',
    keywords: ['农业', '粮食', '种业', '猪肉', '饲料', '农产品'],
    beneficiary: '种业、养殖、饲料、农产品加工',
    caution: '更容易受周期和价格波动影响',
    sectorKeywords: ['农林牧渔', '农业', '养殖', '饲料'],
  },
  {
    label: '军工与安全',
    keywords: ['军工', '国防', '无人机', '卫星', '安全', '低空'],
    beneficiary: '军工、低空经济、卫星通信',
    caution: '题材交易浓时，日内波动会放大',
    sectorKeywords: ['军工', '航空', '卫星', '无人机', '通信设备'],
  },
]

const OVERSEAS_POLICY_THEME_PRESETS: Record<Exclude<MarketType, 'a'>, PolicyThemePreset[]> = {
  hk: [
    {
      label: '中概 / 中国资产',
      keywords: ['港股', '恒指', '恒生', '中概', '离岸人民币', '香港'],
      beneficiary: '恒生科技、中资互联网、港股消费',
      caution: '离岸汇率与监管预期变化快',
      sectorKeywords: ['科技互联网', '中资', '消费医药', '金融红利'],
    },
    {
      label: '利率与美元',
      keywords: ['美联储', '降息', '利率', '美元', '债券', '央行'],
      beneficiary: '金融红利、高股息、防守权重',
      caution: '美元重新走强时，成长估值容易受压',
      sectorKeywords: ['金融红利', '科技互联网'],
    },
    {
      label: '油价与资源',
      keywords: ['原油', '油价', '天然气', '伊朗', '中东', 'OPEC'],
      beneficiary: '石油、航运、资源、上游周期',
      caution: '地缘缓和后资源方向容易快速回吐',
      sectorKeywords: ['能源制造', '中资主题'],
    },
    {
      label: '消费与医药',
      keywords: ['消费', '医药', '旅游', '零售', '药', '内需'],
      beneficiary: '消费龙头、医药、出行与修复链',
      caution: '业绩低于预期时更容易高开低走',
      sectorKeywords: ['消费医药', '科技互联网'],
    },
  ],
  us: [
    {
      label: 'AI 资本开支',
      keywords: ['英伟达', 'AI', '算力', '芯片', '数据中心', '资本开支'],
      beneficiary: '半导体、服务器、云计算链',
      caution: '高估值阶段更怕业绩和指引不及预期',
      sectorKeywords: ['半导体 AI', '科技巨头'],
    },
    {
      label: '利率与宏观',
      keywords: ['美联储', 'CPI', '非农', '收益率', '降息', '通胀'],
      beneficiary: '大市值科技、成长股与美元敏感资产',
      caution: '收益率反弹时，高弹性成长更容易回撤',
      sectorKeywords: ['科技巨头', '半导体 AI'],
    },
    {
      label: '中东与能源',
      keywords: ['伊朗', '中东', '原油', '油轮', '地缘', '能源'],
      beneficiary: '能源、航运、军工与通胀交易',
      caution: '消息脉冲强但持续性取决于事件升级程度',
      sectorKeywords: ['新能源出行', '科技巨头'],
    },
    {
      label: '中概与中国资产',
      keywords: ['中概', '中国资产', '港股', '恒指', '离岸人民币', '中资'],
      beneficiary: '中概互联网、电商、出行与中国 ADR',
      caution: '中美监管和汇率波动会放大盘中振幅',
      sectorKeywords: ['中概互联网', '新能源出行'],
    },
  ],
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

function uniqueStrings(values: string[]) {
  return [...new Set(values.filter(Boolean))]
}

function formatLocalDateToken(value: number | Date = new Date()) {
  const date = typeof value === 'number' ? new Date(value) : value
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
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
    const policySectionTitle = computed(() => (currentMarket.value === 'a' ? '政策导向' : '国际催化'))
    const policySectionSubtitle = computed(() =>
      currentMarket.value === 'a'
        ? '根据实时财经快讯提取政策和产业关键词，再映射到更容易理解的受益方向。'
        : '把港股 / 美股更关键的宏观、利率、地缘和中概催化拆开看，先判断消息会强化哪条主线。',
    )

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

    const marketNarrative = computed(() => {
      if (!leadIndex.value) return '等待实时行情同步。'
      if (currentMarket.value !== 'a') {
        const focusNames = [leadHotStock.value?.name, secondHotStock.value?.name].filter(Boolean).join('、') || '龙头样本'
        if (leadIndex.value.changePercent < 0 && sampleAvgChange.value > 0) {
          return `${leadIndex.value.name} 仍在震荡偏弱区，但活跃样本里的 ${focusNames} 明显更强，当前更像结构分化，不适合把所有信号都当成全面转强。`
        }
        if (marketMood.value === 'risk-on') {
          return `${leadIndex.value.name} 维持强势，活跃样本里 ${focusNames} 继续领跑，当前更适合围绕指数同向的龙头和次强梯队观察扩散。`
        }
        if (marketMood.value === 'risk-off') {
          return `${leadIndex.value.name} 承压，活跃样本分化加大，先盯主指数能否稳住，再决定是否继续跟踪 ${focusNames}。`
        }
        return `${leadIndex.value.name} 处于震荡整理，当前更适合盯龙头承接、次强股跟风和消息催化是否同步，而不是无差别追价。`
      }
      if (marketMood.value === 'risk-on') {
        return `${leadIndex.value.name} 领涨，上涨 ${adv.value.advance} 家 / 下跌 ${adv.value.decline} 家，${sectorLeaders.value[0]?.name || '主线方向'} 和 ${hotStocks.value[0]?.name || '龙头股'} 同步偏强，短线更适合跟放量主线而不是追杂波动。`
      }
      if (marketMood.value === 'risk-off') {
        return `${leadIndex.value.name} 承压，上涨 ${adv.value.advance} 家 / 下跌 ${adv.value.decline} 家，扩散主要集中在 ${sectorLeaders.value[0]?.name || '局部方向'}，更适合先收缩仓位，盯龙头承接和弱势板块回撤。`
      }
      return `${leadIndex.value.name} 维持震荡，上涨 ${adv.value.advance} 家 / 下跌 ${adv.value.decline} 家，${sectorLeaders.value[0]?.name || '主线板块'} 与 ${sectorLeaders.value[1]?.name || '第二梯队'} 轮动延续，优先跟踪核心股是否继续放量。`
    })

    const marketMoodMeta = computed(() => {
      if (marketMood.value === 'risk-on') {
        return {
          label: '盘面偏强',
          hint: currentMarket.value === 'a'
            ? '上涨家数、主线扩散和热点承接暂时占优。'
            : '活跃样本上涨覆盖更高，指数与龙头承接相对更稳。',
        }
      }

      if (marketMood.value === 'risk-off') {
        return {
          label: '盘面偏弱',
          hint: currentMarket.value === 'a'
            ? '下跌家数占优，先看指数止跌与主线修复。'
            : '活跃样本回撤更多，先观察主指数与龙头能否稳住。',
        }
      }

      return {
        label: '盘面震荡',
        hint: currentMarket.value === 'a'
          ? '多空还在拉锯，重点看量能和主线扩散。'
          : '指数与活跃样本分歧较大，更适合先跟踪强弱切换。',
      }
    })

    const defaultDigestHeadline = computed(() =>
      currentMarket.value === 'a'
        ? '未触发AI评估时，先看实时盘面'
        : '未触发AI评估时，先看指数、主题与活跃样本',
    )

    const localEvalSummary = computed(() => {
      if (currentMarket.value !== 'a') {
        const pos = samplePositiveRatio.value.toFixed(0)
        const avg = sampleAvgChange.value >= 0 ? '+' : ''
        return `活跃样本上涨 ${pos}%，均值 ${avg}${sampleAvgChange.value.toFixed(2)}%，成交 ${sampleAvgAmount.value ? formatAmount(sampleAvgAmount.value) : '待同步'}`
      }
      return `上涨 ${adv.value.advance} / 下跌 ${adv.value.decline}，成交额 ${formatAmount(adv.value.totalAmount)}，${leadIndex.value ? leadIndex.value.name + ' ' + formatPercent(leadIndex.value.changePercent) + '%' : '指数待同步'}`
    })

    const defaultDigestCards = computed(() => {
      if (currentMarket.value === 'a') {
        return [
          {
            label: '上涨 / 下跌',
            value: `${adv.value.advance} / ${adv.value.decline}`,
            detail: `平盘 ${adv.value.flat} 家，涨跌温度 ${breadthScore.value >= 0 ? '+' : ''}${breadthScore.value.toFixed(1)}。`,
          },
          {
            label: '领涨指数',
            value: leadIndex.value ? `${leadIndex.value.name} ${formatPercent(leadIndex.value.changePercent)}%` : '--',
            detail: leadIndex.value ? `成交额 ${formatAmount(leadIndex.value.amount)}，先看指数是否继续带量。`
              : '等待核心指数同步。',
          },
          {
            label: '主线板块',
            value: sectorLeaders.value[0]?.name || '--',
            detail: sectorLeaders.value[0]
              ? `当前代表股 ${sectorLeaders.value[0].leadingStock || '待同步'}，先看扩散还是只剩龙头。`
              : '等待板块热度同步。',
          },
          {
            label: '消息温度',
            value: newsSentiment.value.label,
            detail: `${newsSentiment.value.hint}${policyGuides.value[0]?.label ? ` 当前更贴近 ${policyGuides.value[0].label}。` : ''}`,
          },
        ]
      }

      return [
        {
          label: '上涨覆盖',
          value: `${samplePositiveRatio.value.toFixed(0)}%`,
          detail: `下跌覆盖 ${sampleNegativeRatio.value.toFixed(0)}%，样本均值 ${sampleAvgChange.value >= 0 ? '+' : ''}${sampleAvgChange.value.toFixed(2)}%。`,
        },
        {
          label: '领涨指数',
          value: leadIndex.value ? `${leadIndex.value.name} ${formatPercent(leadIndex.value.changePercent)}%` : '--',
          detail: leadIndex.value ? `成交额 ${formatAmount(leadIndex.value.amount)}，先看主指数是否稳住。`
            : '等待核心指数同步。',
        },
        {
          label: '活跃主题',
          value: leadDisplaySector.value?.name || '--',
          detail: leadDisplaySector.value
            ? `代表股 ${leadDisplaySector.value.leadingStock || '待同步'}，观察是否从龙头扩散到第二梯队。`
            : '等待主题热度同步。',
        },
        {
          label: '消息温度',
          value: newsSentiment.value.label,
          detail: `${newsSentiment.value.hint}${policyGuides.value[0]?.label ? ` 当前更贴近 ${policyGuides.value[0].label}。` : ''}`,
        },
      ]
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
          hint: '看新闻和社会面更偏利多还是利空。',
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
        return [
          {
            label: '市场温度',
            value: `${breadthScore.value >= 0 ? '+' : ''}${breadthScore.value.toFixed(1)}`,
            hint: '活跃样本上涨覆盖换算后的风险偏好分数',
            description: '把当前活跃样本的上涨覆盖和下跌覆盖折成一个温度值，快速判断海外情绪更偏 risk-on 还是 risk-off。',
            range: '接近 +100 说明样本几乎普涨，接近 -100 说明活跃样本普遍承压；单看温度不够，还要叠加主指数方向和龙头承接。',
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
          label: '市场温度',
          value: `${breadthScore.value >= 0 ? '+' : ''}${breadthScore.value.toFixed(1)}`,
          hint: '涨跌家数差 / 总家数',
          description: '把全市场涨跌家数差折成一个温度值，快速判断盘面偏普涨还是偏普跌。',
          range: '接近 +100 说明普涨很强，接近 -100 说明亏钱效应明显；若温度回升但成交额不跟，通常只是修复。',
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
          label: '政策导向',
          value: policyGuides.value[0]?.label || '--',
          hint: policyGuides.value[0]?.headline || '等待政策与社会面催化',
          description: '把当天命中次数最高的政策或社会面方向直接提上来，方便判断利好在强化哪条板块链条。',
          range: '同一方向连续出现多条消息，且对应板块同步放量时，政策方向更值得提高优先级。',
          tone: policyGuides.value[0]?.matchCount ? 'balanced' : 'risk-off',
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
          label: '社会面',
          value: newsSentiment.value.label,
          hint: latestDigestNews.value?.title || '等待当日政策、国际与社会面消息',
          description: '把新闻和社会面情绪压缩成一个直观判断，帮助你先看环境再看个股。',
          range: '偏暖利于主线延续，中性看轮动，偏谨慎时要优先控制回撤和追高节奏。',
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

    const policyGuides = computed(() => {
      const sample = digestNewsItems.value.slice(0, 48)
      const presets =
        currentMarket.value === 'a'
          ? POLICY_THEME_PRESETS
          : OVERSEAS_POLICY_THEME_PRESETS[currentMarket.value]
      const sectorSource = currentMarket.value === 'a' ? sectorLeaders.value : displaySectorLeaders.value

      return presets.map((preset) => {
        const matches = sample.filter((item) => preset.keywords.some((keyword) => buildNewsText(item).includes(keyword)))
        const firstHeadline = matches[0]
        const secondHeadline = matches[1]
        const recommendedStocks = uniqueStrings([
          ...sectorSource
            .filter((sector) => preset.sectorKeywords.some((keyword) => sector.name.includes(keyword)))
            .map((sector) => sector.leadingStock || ''),
          ...hotStocks.value
            .filter((stock) => preset.keywords.some((keyword) => stock.name.includes(keyword)))
            .map((stock) => stock.name),
          ...hotStocks.value.slice(0, 5).map((stock) => stock.name),
        ]).slice(0, 3)
        return {
          label: preset.label,
          beneficiary: preset.beneficiary,
          caution: preset.caution,
          matchCount: matches.length,
          headline: firstHeadline?.title || '',
          source: firstHeadline?.source || '',
          recommendedStocks,
          tone: matches.length >= 2 ? 'active' : matches.length === 1 ? 'watch' : 'idle',
          summary: matches.length
            ? currentMarket.value === 'a'
              ? `近端已命中 ${matches.length} 条 ${preset.label} 相关快讯，先看 ${preset.beneficiary} 是否同步放量${secondHeadline ? `，并留意 ${secondHeadline.title.slice(0, 18)}` : ''}。`
              : `近端已命中 ${matches.length} 条 ${preset.label} 相关快讯，先看 ${preset.beneficiary} 是否与 ${leadIndex.value?.name || '核心指数'} 同步，${secondHeadline ? `并继续跟踪 ${secondHeadline.title.slice(0, 20)}` : '再看龙头是否承接'}。`
            : currentMarket.value === 'a'
              ? `当前快讯没有对 ${preset.label} 形成集中催化，先放入观察列表，等消息频次和板块强度一起抬升。`
              : `当前快讯还没有把 ${preset.label} 推成主线，更适合先放进观察清单，等指数、主题和催化一起共振。`,
        }
      }).sort((a, b) => b.matchCount - a.matchCount)
    })

    const marketOutlookCards = computed(() => {
      if (currentMarket.value !== 'a') {
        const leadCatalyst = policyGuides.value[0]
        const secondCatalyst = policyGuides.value[1]
        return [
          {
            label: '当前预期',
            value: leadIndex.value && leadIndex.value.changePercent >= 0 ? '强势延续' : '等待确认',
            detail: leadIndex.value
              ? `${leadIndex.value.name} 当前 ${formatPercent(leadIndex.value.changePercent)}%，先看主指数能否继续稳住。`
              : '等待主指数同步后再判断节奏。',
          },
          {
            label: '先盯指数',
            value: [leadIndex.value?.name, secondIndex.value?.name].filter(Boolean).join(' / ') || '等待同步',
            detail: leadIndex.value && secondIndex.value
              ? `先看 ${leadIndex.value.name} 与 ${secondIndex.value.name} 是否同向，再决定继续跟成长还是切回防守。`
              : '先把主指数方向确认清楚，再看个股扩散。',
          },
          {
            label: '主线主题',
            value: leadDisplaySector.value?.name || '等待同步',
            detail: leadDisplaySector.value
              ? `${leadDisplaySector.value.name} 当前 ${formatPercent(leadDisplaySector.value.changePercent)}%，先看 ${leadDisplaySector.value.leadingStock || '龙头股'} 能否继续带动扩散。`
              : '等待主题热度同步后再判断主线。',
          },
          {
            label: '龙头清单',
            value: [leadHotStock.value?.name, secondHotStock.value?.name].filter(Boolean).join('、') || '等待同步',
            detail: leadHotStock.value
              ? `优先看 ${leadHotStock.value.name}${secondHotStock.value ? `、${secondHotStock.value.name}` : ''} 是否继续放量领涨。`
              : '等待活跃龙头同步。',
          },
          {
            label: '次强跟随',
            value: hotStocks.value.slice(2, 5).map((item) => item.name).join('、') || '等待同步',
            detail: hotStocks.value.length > 2
              ? `重点看 ${hotStocks.value.slice(2, 5).map((item) => item.name).join('、')} 是否能跟着龙头继续放量。`
              : '等待次强梯队补齐。',
          },
          {
            label: '风险锚点',
            value: newsSentiment.value.tone === 'risk-off' ? '利率 / 地缘 / 财报' : '追高与分歧日回落',
            detail: '海外市场更容易受财报、利率和地缘事件影响，盘中更要看承接而不是只看涨跌幅。',
          },
          {
            label: '消息催化',
            value: latestDigestNews.value?.source || '等待同步',
            detail: latestDigestNews.value?.title || '当前还没有更贴近主线的最新快讯。',
          },
          {
            label: '政策 / 社会面',
            value: leadCatalyst?.label || '等待同步',
            detail: leadCatalyst
              ? `${leadCatalyst.label} 当前更容易影响 ${leadCatalyst.beneficiary}，推荐优先盯 ${leadCatalyst.recommendedStocks.join('、') || '主线龙头'}。`
              : '等待更清晰的宏观、利率或地缘刺激方向。',
          },
          {
            label: '第二催化',
            value: secondCatalyst?.label || '等待同步',
            detail: secondCatalyst
              ? `${secondCatalyst.label} 是下一条需要盯的风险锚点，留意 ${secondCatalyst.caution}。`
              : '次级催化还没有形成连续消息流。',
          },
          {
            label: '执行节奏',
            value: '先指数后个股',
            detail: '先确认主指数方向，再决定做科技成长、红利防守还是继续等待。',
          },
        ]
      }

      const topSector = sectorLeaders.value[0]
      const secondSector = sectorLeaders.value[1]
      const leadPolicy = policyGuides.value[0]
      const expectation =
        marketMood.value === 'risk-on' && fundflowSummary.value.positiveCount >= 3
          ? '主线强化'
          : marketMood.value === 'risk-off'
            ? '防守优先'
            : '轮动延续'
      const focus = [topSector?.name, secondSector?.name].filter(Boolean).join('、') || fundflowSummary.value.leaders || '等待热点同步'
      const riskValue =
        newsSentiment.value.tone === 'risk-off'
          ? '高位题材与弱承接分支'
          : `${leadPolicy?.caution || '追高与缩量反抽'}`
      const tempo =
        marketMood.value === 'risk-on'
          ? '先看主线扩散，再处理个股'
          : marketMood.value === 'risk-off'
            ? '先保留仓位，再等止跌确认'
            : '先选强于指数的方向'

      return [
        {
          label: '未来预期',
          value: expectation,
          detail: `${marketNarrative.value} ${fundflowSummary.value.totalNetInflow >= 0 ? '主力资金暂未转弱。' : '主力资金分歧加大。'}`,
        },
        {
          label: '优先关注',
          value: focus,
          detail: `优先看 ${focus} 里是否继续放量，以及龙头能否带出第二梯队。`,
        },
        {
          label: '先盯什么',
          value: `${leadIndex.value?.name || '指数'} / ${topSector?.name || '主线'} / ${hotStocks.value[0]?.name || '龙头'}`,
          detail: `先看 ${leadIndex.value?.name || '指数'} 是否稳，${topSector?.name || '主线'} 是否继续扩散，再看 ${hotStocks.value[0]?.name || '龙头'} 能否维持承接。`,
        },
        {
          label: '政策刺激',
          value: leadPolicy?.label || '等待同步',
          detail: leadPolicy
            ? `${leadPolicy.label} 当前更利好 ${leadPolicy.beneficiary}，推荐优先看 ${leadPolicy.recommendedStocks.join('、') || topSector?.leadingStock || '龙头股'}。`
            : '还没有形成足够明确的政策主线。',
        },
        {
          label: '次级催化',
          value: policyGuides.value[1]?.label || '等待同步',
          detail: policyGuides.value[1]
            ? `${policyGuides.value[1].label} 是第二观察方向，可继续留意 ${policyGuides.value[1].recommendedStocks.join('、') || secondSector?.leadingStock || '次强股'}。`
            : '第二层催化还没有形成连续消息。',
        },
        {
          label: '风险方向',
          value: riskValue,
          detail: `如果 ${newsSentiment.value.label} 消息情绪和盘口承接同时转弱，要先防回撤再谈加仓。`,
        },
        {
          label: '操作节奏',
          value: tempo,
          detail: '先看指数和板块是否共振，再决定低吸、跟随还是继续等待。',
        },
        {
          label: '推荐股票',
          value: uniqueStrings([
            ...(leadPolicy?.recommendedStocks || []),
            hotStocks.value[0]?.name || '',
            hotStocks.value[1]?.name || '',
          ]).slice(0, 3).join('、') || '等待同步',
          detail: '优先观察这些股票是否继续放量、带动跟风，并与主线板块形成共振。',
        },
      ]
    })

    const sessionInsights = computed(() => {
      if (currentMarket.value !== 'a') {
        const watched = hotStocks.value.slice(0, 3)
        const watchText = watched.length
          ? watched.map((item) => `${item.name}(${item.code})`).join('、')
          : '等待热点股同步'

        return [
          {
            label: '上午盘点评',
            description: '看开盘后 30 到 90 分钟谁在定方向，先确认指数、主线主题和龙头是不是同步转强。',
            range: '重点看三件事：主指数涨跌幅和成交额是否同步放大；最强主题有没有从单只龙头扩散到第二梯队；龙头是高开高走还是冲高回落。三项只满足一项时，更多当作试盘。',
            summary: `${leadIndex.value?.name || '主指数'} 开盘后的方向优先级最高，当前成交额约 ${leadIndex.value ? formatAmount(leadIndex.value.amount) : '--'}。盘初急拉时更要看 ${leadHotStock.value?.name || '龙头'} 和 ${leadDisplaySector.value?.name || '主线主题'} 是否同步走强，否则更像情绪试盘。`,
          },
          {
            label: '下午盘点评',
            description: '看午后承接和回封，判断上午的强弱是不是能真正延续到收盘。',
            range: '重点观察午后回落后能否重新放量拉起、强势股有没有开板再封、次强股是否愿意跟随。如果只剩龙头硬撑、板块跟风消失，尾盘更容易转成分化。',
            summary: `如果 ${leadHotStock.value?.name || '强势龙头'} 午后还能维持高位，并且 ${secondHotStock.value?.name || '次强样本'} 继续跟上，同时 ${policyGuides.value[0]?.label || '社会面催化'} 还在发酵，才说明行情不是单点脉冲；否则更像抱团后的回落测试。`,
          },
          {
            label: '宏观与消息',
            description: '把利率、财报、国际热点和最新快讯翻成盘面影响，判断催化到底强化了哪条主线。',
            range: '先区分消息是短脉冲还是持续催化：利率和财报更影响估值，地缘和油价更影响风险偏好与资源链；只有消息、指数和主线同时共振，持续性才更高。',
            summary: `${newsSentiment.value.hint}，当前更要把 ${policyGuides.value[0]?.label || '国际催化'}、${leadDisplaySector.value?.name || '主线主题'} 和 ${latestDigestNews.value?.title || '最新快讯'} 放在一起看。若催化只推高单只龙头而没有带动主题扩散，持续性通常有限。`,
          },
          {
            label: '建议关注',
            description: '不是直接给买卖点，而是告诉你今天优先盯哪组“指数 + 主题 + 龙头”的组合。',
            range: '优先级通常是 指数 > 主线主题 > 龙头 > 次强。指数不配合时，个股脉冲更容易回落；指数稳定而主题扩散时，再去看龙头和次强的承接会更有效。',
            summary: `今天优先跟踪 ${watchText}，重点看龙头、主题与主指数是否继续共振，并留意 ${policyGuides.value[0]?.recommendedStocks.join('、') || '催化受益股'} 有没有补涨。`,
          },
        ]
      }

      const currentLeadIndex = indices.value[0]
      const firstSector = sectorLeaders.value[0]
      const secondSector = sectorLeaders.value[1]
      const watched = hotStocks.value.slice(0, 3)
      const watchText = watched.length
        ? watched.map((item) => `${item.name}(${item.code})`).join('、')
        : '等待热点股同步'

      return [
        {
          label: '上午盘点评',
          description: '看早盘资金先去哪里，先确认指数有没有止跌或放量上攻，再判断主线能不能扩散。',
          range:
            '重点看核心指数量价是否同步、最强板块有没有从一两只龙头扩散到更多个股、热点股是否高开高走而不是冲高回落。指数弱而板块独强时，持续性通常要打折。',
          summary:
              marketMood.value === 'risk-on'
              ? `开盘到午前更适合盯 ${currentLeadIndex?.name || '核心指数'} 的量价配合，当前两市成交额约 ${formatAmount(adv.value.totalAmount)}，强势方向先看 ${firstSector?.name || '主线板块'} 是否继续扩散。`
              : `上午盘优先看 ${currentLeadIndex?.name || '指数'} 是否止跌，当前两市成交额约 ${formatAmount(adv.value.totalAmount)}；若热点无法扩散，尽量先观察而不是追高。`,
        },
        {
          label: '下午盘点评',
          description: '看午后承接、回封和扩散，确认上午的强弱是不是能带到收盘。',
          range:
            '重点观察午后回落后有没有资金承接、强势股能否回封或继续新高、第二梯队是否接力。如果午后只剩少数高位股维持，通常更像修复而不是全面回暖。',
          summary:
            marketMood.value === 'risk-off'
              ? `午后重点看承接是否改善，并结合 ${policyGuides.value[0]?.label || '政策催化'} 是否继续发酵；若缩量反弹，更多是修复而不是全面转强。`
              : `午后要观察强势股是否继续封住、板块是否有第二梯队接力，并确认 ${policyGuides.value[0]?.label || '政策催化'} 有没有继续强化，只有扩散成功才算真正回暖。`,
        },
        {
          label: '政策与社会面',
          description: '把政策催化、产业新闻和社会面事件翻译成受益方向与风险方向，不只看标题本身。',
          range:
            '先分清是短消息还是连续催化。政策支持要看有没有多条消息连续出现并带动板块放量；社会面事件要看它影响的是消费、出行、资源还是整体风险偏好。',
          summary: `${aiDigest.value?.socialView || '社会面暂无额外冲击'} 当前对 ${firstSector?.name || '强势方向'}、${secondSector?.name || '轮动方向'} 更值得继续跟踪，最好同时确认 ${policyGuides.value[0]?.label || '消息催化'} 有没有持续放大，以及 ${policyGuides.value[0]?.recommendedStocks.join('、') || '受益股'} 是否同步转强。`,
        },
        {
          label: '建议关注',
          description: '把今天最值得跟踪的指数、板块和龙头组合列出来，方便盯盘时先抓主线再看个股。',
          range:
            '优先级通常是 指数 > 主线板块 > 龙头 > 次强跟风。指数不支持时，个股强势更容易变成脉冲；指数与板块共振时，再看龙头和次强是否一起放量。',
          summary: `今天优先跟踪 ${watchText}，先看龙头是否放量、板块是否有跟风、指数是否支持信号延续，再把 ${policyGuides.value[0]?.recommendedStocks.join('、') || '政策受益股'} 放进观察列表。`,
        },
      ]
    })

    async function loadFundflow() {
      if (currentMarket.value !== 'a') {
        fundflowLeaders.value = []
        return
      }
      try {
        const res = await get<{ data: FundFlow[] }>('/api/fundflow/rank?limit=18')
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

      if (trackedCodes.length) {
        tasks.push(marketStore.fetchQuotes(trackedCodes))
      }
      if (market === 'a') {
        tasks.push(
          marketStore.fetchAdvanceDecline(),
          marketStore.fetchSectors('industry'),
          loadFundflow(),
        )
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
      const shouldFetchStocks = forceStocks || !marketStore.stockList.length || market !== marketStore.currentMarket
      dashboardLoading.value = true

      await Promise.allSettled([
        marketStore.fetchIndices(market),
        newsStore.fetchNews(),
        shouldFetchStocks
          ? marketStore.fetchStockList(market, 1, market === 'a' ? 40 : 24)
          : Promise.resolve(),
      ])

      if (isStaleHomeLoad(seq, market)) return
      dashboardLoading.value = false
      void loadDashboardDeferred(seq, market)
    }

    function switchMarket(market: MarketType) {
      currentMarket.value = market
      aiDigest.value = null
      lastDigestAt.value = 0
      void loadDashboard(true)
    }

    function navigateToStock(code: string) {
      router.push({ name: 'stockDetail', params: { code } })
    }

    function formatNewsTime(timeStr: string) {
      if (!timeStr) return ''
      return timeStr.slice(5, 16)
    }

    async function refreshDigest() {
      const task = aiTaskLogger.createTask('AI市场点评', 'home')
      homeAiTaskId = task.id
      aiDigestLoading.value = true
      aiTaskLogger.addLog(task.id, '开始收集盘面数据...')

      try {
        aiTaskLogger.addLog(task.id, `当前市场：${currentMarket.value === 'a' ? 'A股' : currentMarket.value === 'hk' ? '港股' : '美股'}，正在构建分析输入...`)

        aiTaskLogger.addLog(task.id, '正在调用AI模型生成点评...')
        aiDigest.value = await generateDigest(settingsStore.activeProvider, {
          title: '首页市场概览',
          market: currentMarket.value,
          currentTime: new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }),
          facts: [
            marketNarrative.value,
            currentMarket.value === 'a'
              ? `上涨 ${adv.value.advance} 家，下跌 ${adv.value.decline} 家，两市成交额 ${formatAmount(adv.value.totalAmount)}`
              : `活跃样本上涨覆盖 ${samplePositiveRatio.value.toFixed(0)}%，下跌覆盖 ${sampleNegativeRatio.value.toFixed(0)}%，均值 ${sampleAvgChange.value >= 0 ? '+' : ''}${sampleAvgChange.value.toFixed(2)}%`,
            leadIndex.value ? `${leadIndex.value.name} 当前 ${formatPercent(leadIndex.value.changePercent)}%，成交额 ${formatAmount(leadIndex.value.amount)}` : '核心指数等待同步',
            secondIndex.value ? `${secondIndex.value.name} 当前 ${formatPercent(secondIndex.value.changePercent)}%` : '第二指数等待同步',
            thirdIndex.value ? `${thirdIndex.value.name} 当前 ${formatPercent(thirdIndex.value.changePercent)}%` : '第三指数等待同步',
            hotStocks.value[0] ? `热点股以 ${hotStocks.value[0].name} 为代表，涨跌幅 ${formatPercent(hotStocks.value[0].changePercent)}%` : '热点股等待同步',
            hotStocks.value[1] ? `次强股 ${hotStocks.value[1].name} 当前 ${formatPercent(hotStocks.value[1].changePercent)}%，用于观察跟风强度` : '次强样本等待同步',
            displaySectorLeaders.value[0]
              ? `${currentMarket.value === 'a' ? '板块热度' : '主题热度'}领先的是 ${displaySectorLeaders.value[0].name}`
              : currentMarket.value === 'a' ? '板块热度等待同步' : '当前更看指数和龙头清单',
            currentMarket.value !== 'a' ? `前三活跃样本成交集中度 ${sampleTopAmountShare.value.toFixed(0)}%` : 'A 股更重视广度与主力资金同步',
            fundflowSummary.value.leaders ? `主力净流入靠前的是 ${fundflowSummary.value.leaders}` : '主力资金榜等待同步',
            currentMarket.value === 'a'
              ? (policyGuides.value[0] ? `政策导向更偏 ${policyGuides.value[0].label}` : '政策导向等待同步')
              : (lagDisplaySector.value ? `当前更弱的主题是 ${lagDisplaySector.value.name}` : '弱势主题等待同步'),
            policyGuides.value[0]
              ? `${currentMarket.value === 'a' ? '消息催化' : '国际催化'}最强的是 ${policyGuides.value[0].label}${policyGuides.value[0].matchCount ? `，已命中 ${policyGuides.value[0].matchCount} 条` : ''}`
              : `${currentMarket.value === 'a' ? '政策导向' : '国际催化'}等待同步`,
            policyGuides.value[1]
              ? `第二观察锚点是 ${policyGuides.value[1].label}，受益方向偏 ${policyGuides.value[1].beneficiary}`
              : '第二催化锚点等待同步',
            policyGuides.value[0]?.recommendedStocks.length
              ? `当前催化优先关注 ${policyGuides.value[0].recommendedStocks.join('、')}`
              : '催化对应股票等待同步',
            latestDigestNews.value ? `最新快讯来自 ${latestDigestNews.value.source || '快讯'}：${latestDigestNews.value.title}` : '最新快讯等待同步',
          ],
          news: digestNewsItems.value.slice(0, 20).map((item) => `${item.source || '快讯'} ${item.publishTime.slice(11, 16)}：${item.title}`),
          social:
            currentMarket.value === 'a'
              ? policyGuides.value.slice(0, 8).map((item) => `${item.label}：利好 ${item.beneficiary}，推荐 ${item.recommendedStocks.join('、') || '待同步'}，${item.headline || item.summary}`)
              : policyGuides.value.slice(0, 8).map((item) => `${item.label}：利好 ${item.beneficiary}，推荐 ${item.recommendedStocks.join('、') || '待同步'}，${item.headline || item.summary}`),
          trendHints: [
            marketMood.value === 'risk-on' ? '短线情绪偏强，但仍要先确认成交额和主线扩散，不适合无差别追高。' : '情绪未全面转强，优先等分歧后的确认点，并用成交额确认反弹质量。',
            leadHotStock.value ? `重点盯 ${leadHotStock.value.name}${secondHotStock.value ? `、${secondHotStock.value.name}` : ''} 的承接、回落后的放量修复以及是否带动更多跟风。` : '龙头样本待同步',
            marketOutlookCards.value[0] ? `${marketOutlookCards.value[0].value}：${marketOutlookCards.value[0].detail}` : '未来预期等待同步',
            marketOutlookCards.value[1] ? `${marketOutlookCards.value[1].label}：${marketOutlookCards.value[1].detail}` : '观察框架等待同步',
            policyGuides.value[0] ? `${policyGuides.value[0].label}：${policyGuides.value[0].summary}` : '政策与社会面等待同步',
          ],
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

        aiTaskLogger.addLog(task.id, `AI点评生成完成（${aiDigest.value.source === 'ai' ? 'AI模型' : '本地规则'}）`, 'success')
        aiTaskLogger.completeTask(task.id, true)
      } catch (error) {
        if (aiTaskLogger.isTaskCancelled(task.id)) {
          aiTaskLogger.addLog(task.id, '评估已被取消', 'warn')
        } else {
          const msg = error instanceof Error ? error.message : String(error)
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
      await newsStore.fetchNews()
    }, { intervalMultiplier: 2, immediate: false, minimumMs: 15000, pauseWhenHidden: true })

    const secondaryPolling = useRealtimeTask(async () => {
      if (!isTradingSession.value) return
      await marketStore.fetchStockList(currentMarket.value, 1, currentMarket.value === 'a' ? 40 : 24)
      if (currentMarket.value === 'a') {
        await Promise.all([
          marketStore.fetchAdvanceDecline(),
          marketStore.fetchSectors('industry'),
          loadFundflow(),
        ])
      }
    }, {
      intervalMultiplier: 1,
      immediate: false,
      minimumMs: 10000,
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
      defaultDigestHeadline,
      defaultDigestCards,
      sessionInsights,
      policySectionTitle,
      policySectionSubtitle,
      policyGuides,
      marketOutlookCards,
      newsSentiment,
      marketMood,
      marketMoodMeta,
      marketNarrative,
      localEvalSummary,
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
