import type { DataSource, SearchProvider } from '@/types/settings'
import type { PromptTemplate, Strategy } from '@/types/strategy'

export const APP_NAME = 'MI Quantify'
export const PYTHON_SIDECAR_PORT = 18911
export const PYTHON_SIDECAR_URL = `http://localhost:${PYTHON_SIDECAR_PORT}`
const LOCAL_PROXY_PRESET_ID = 'local_proxy_127001_7890'

export const NAV_ITEMS = [
  { path: '/', name: 'home', label: '首页', icon: 'Home' },
  { path: '/market', name: 'market', label: '股票列表', icon: 'BarChart3' },
  { path: '/monitor', name: 'monitor', label: '关注监听', icon: 'BellRing' },
  { path: '/analysis', name: 'analysis', label: '个股分析', icon: 'CandlestickChart' },
  { path: '/ask', name: 'ask', label: 'AI问股', icon: 'MessageSquareText' },
  { path: '/strategy', name: 'strategy', label: '策略', icon: 'BrainCircuit' },
  { path: '/settings', name: 'settings', label: '设置', icon: 'Settings' },
] as const

export const SEARCH_PROVIDER_PRESETS: Omit<SearchProvider, 'apiKey'>[] = [
  {
    id: 'zhipu-web-search',
    name: '智谱 Web Search',
    enabled: false,
    apiUrl: 'https://open.bigmodel.cn/api/paas/v4/tools',
    provider: 'zhipu',
  },
  {
    id: 'searxng-search',
    name: 'SearXNG',
    enabled: false,
    apiUrl: 'http://127.0.0.1:8080/search',
    provider: 'searxng',
  },
  {
    id: 'yacy-search',
    name: 'YaCy',
    enabled: false,
    apiUrl: 'http://127.0.0.1:8090/yacysearch.json',
    provider: 'yacy',
  },
  {
    id: 'brave-search',
    name: 'Brave Search',
    enabled: false,
    apiUrl: 'https://api.search.brave.com/res/v1/web/search',
    provider: 'brave',
    proxyId: LOCAL_PROXY_PRESET_ID,
  },
  {
    id: 'tavily-search',
    name: 'Tavily',
    enabled: false,
    apiUrl: 'https://api.tavily.com/search',
    provider: 'tavily',
    proxyId: LOCAL_PROXY_PRESET_ID,
  },
  {
    id: 'serpapi-search',
    name: 'SerpApi',
    enabled: false,
    apiUrl: 'https://serpapi.com/search.json',
    provider: 'serpapi',
    proxyId: LOCAL_PROXY_PRESET_ID,
  },
  {
    id: 'serper-search',
    name: 'Serper',
    enabled: false,
    apiUrl: 'https://google.serper.dev/search',
    provider: 'serper',
    proxyId: LOCAL_PROXY_PRESET_ID,
  },
  {
    id: 'exa-search',
    name: 'Exa',
    enabled: false,
    apiUrl: 'https://api.exa.ai/search',
    provider: 'exa',
    proxyId: LOCAL_PROXY_PRESET_ID,
  },
  {
    id: 'custom-search',
    name: '自定义搜索',
    enabled: false,
    apiUrl: '',
    provider: 'custom',
  },
]

export const DATA_SOURCE_PRESETS: Omit<DataSource, 'apiKey' | 'apiSecret'>[] = [
  {
    id: 'akshare',
    name: 'AkShare',
    enabled: true,
    type: 'free',
    apiUrl: PYTHON_SIDECAR_URL,
    priority: 1,
    mode: 'sidecar',
    coverage: 'A / 港 / 美 / 宏观',
    description: '本地 Python 聚合库，适合 A 股、基金、宏观和部分海外行情补数。',
  },
  {
    id: 'eastmoney',
    name: '东方财富',
    enabled: true,
    type: 'free',
    apiUrl: PYTHON_SIDECAR_URL,
    priority: 1,
    mode: 'sidecar',
    coverage: 'A 股 / 财务 / 新闻',
    description: '当前明细财务、新闻和个股补充数据的重要免费源之一。',
  },
  {
    id: 'easyquotation',
    name: 'EasyQuotation / 实时行情',
    enabled: true,
    type: 'free',
    apiUrl: PYTHON_SIDECAR_URL,
    priority: 1,
    mode: 'sidecar',
    coverage: 'A / 港 / 美 实时',
    description: '当前行情页默认聚合入口之一，适合快速拉取批量报价。',
  },
  {
    id: 'sina',
    name: '新浪财经',
    enabled: true,
    type: 'free',
    apiUrl: PYTHON_SIDECAR_URL,
    priority: 2,
    mode: 'sidecar',
    coverage: 'A / 港 / 美 / 指数',
    description: '当前股票搜索、列表与指数抓取的主免费源；若网络屏蔽会直接影响展示。',
  },
  {
    id: 'google-news-rss',
    name: 'Google News RSS',
    enabled: true,
    type: 'free',
    apiUrl: 'https://news.google.com/rss',
    priority: 2,
    mode: 'remote',
    coverage: '全球新闻 / 政策 / 国际消息',
    description: '免费 RSS 检索源，适合作为国际新闻、政策和主题事件补充。',
    proxyId: LOCAL_PROXY_PRESET_ID,
  },
  {
    id: 'yahoo-finance-rss',
    name: 'Yahoo Finance RSS',
    enabled: true,
    type: 'free',
    apiUrl: 'https://feeds.finance.yahoo.com/rss/2.0',
    priority: 2,
    mode: 'remote',
    coverage: '美股 / 港股 / 公司新闻',
    description: '适合补充海外个股与公司相关新闻。',
    proxyId: LOCAL_PROXY_PRESET_ID,
  },
  {
    id: 'stooq',
    name: 'Stooq',
    enabled: false,
    type: 'free',
    apiUrl: 'https://stooq.com',
    priority: 3,
    mode: 'remote',
    coverage: '全球股票 / 指数 / EOD',
    description: '免费全球日线与指数数据源，适合作为海外行情兜底。',
    proxyId: LOCAL_PROXY_PRESET_ID,
  },
  {
    id: 'yfinance',
    name: 'Yahoo Finance / yfinance',
    enabled: false,
    type: 'free',
    apiUrl: PYTHON_SIDECAR_URL,
    priority: 3,
    mode: 'sidecar',
    coverage: '美股 / 港股 / 财务 / 历史',
    description: '适合作为海外 K 线、财务与公司信息补充。',
  },
  {
    id: 'rsshub',
    name: 'RSSHub',
    enabled: false,
    type: 'free',
    apiUrl: 'https://rsshub.app',
    priority: 3,
    mode: 'remote',
    coverage: '财经 RSS / 自定义聚合',
    description: '开源自建聚合源，可接更多财经站点 RSS。',
  },
  {
    id: 'baostock',
    name: 'BaoStock',
    enabled: true,
    type: 'free',
    apiUrl: PYTHON_SIDECAR_URL,
    priority: 2,
    mode: 'sidecar',
    coverage: 'A 股历史',
    description: '偏历史与基础数据，适合日线与回测补充。',
  },
  {
    id: 'tushare',
    name: 'Tushare Pro',
    enabled: false,
    type: 'paid',
    apiUrl: 'https://api.tushare.pro',
    priority: 3,
    mode: 'remote',
    coverage: 'A 股 / 基本面 / 特色数据',
    description: '国内常用专业数据接口，覆盖财务、筹码、公告和因子类数据。',
    requiresKey: true,
  },
  {
    id: 'jqdata',
    name: 'JoinQuant / 聚宽',
    enabled: false,
    type: 'paid',
    apiUrl: 'https://dataapi.joinquant.com/apis',
    priority: 4,
    mode: 'remote',
    coverage: 'A 股 / 因子 / 回测',
    description: '适合量化研究、因子与回测，个人与机构都比较常见。',
    requiresKey: true,
  },
  {
    id: 'rqdata',
    name: 'Ricequant / RQData',
    enabled: false,
    type: 'paid',
    apiUrl: 'https://rqdatad-pro.ricequant.com',
    priority: 4,
    mode: 'remote',
    coverage: 'A / 期货 / 基金 / 宏观',
    description: '偏研究与量化终端场景，适合多资产扩展。',
    requiresKey: true,
    requiresSecret: true,
  },
  {
    id: 'alphavantage',
    name: 'Alpha Vantage',
    enabled: false,
    type: 'paid',
    apiUrl: 'https://www.alphavantage.co/query',
    priority: 5,
    mode: 'remote',
    coverage: '美股 / 外汇 / 指标',
    description: '全球最常见的轻量行情接口之一，免费层也能跑基础验证。',
    requiresKey: true,
  },
  {
    id: 'gnews',
    name: 'GNews',
    enabled: false,
    type: 'free',
    apiUrl: 'https://gnews.io/api/v4',
    priority: 5,
    mode: 'remote',
    coverage: '全球新闻 / 主题检索',
    description: '免费额度可用于补充国际财经新闻与主题搜索。',
    requiresKey: true,
  },
  {
    id: 'newsapi',
    name: 'NewsAPI',
    enabled: false,
    type: 'free',
    apiUrl: 'https://newsapi.org/v2',
    priority: 5,
    mode: 'remote',
    coverage: '全球新闻 / 主题检索',
    description: '免费开发层可用于新闻聚合验证。',
    requiresKey: true,
  },
  {
    id: 'mediastack',
    name: 'Mediastack',
    enabled: false,
    type: 'free',
    apiUrl: 'https://api.mediastack.com/v1',
    priority: 5,
    mode: 'remote',
    coverage: '新闻聚合 / 国际市场',
    description: '免费层可作为国际资讯补充。',
    requiresKey: true,
  },
  {
    id: 'finnhub',
    name: 'Finnhub',
    enabled: false,
    type: 'paid',
    apiUrl: 'https://finnhub.io/api/v1',
    priority: 5,
    mode: 'remote',
    coverage: '美股 / 新闻 / 事件',
    description: '美股与新闻事件数据常用，适合新闻、财报日历和实时接口扩展。',
    requiresKey: true,
  },
  {
    id: 'twelvedata',
    name: 'Twelve Data',
    enabled: false,
    type: 'paid',
    apiUrl: 'https://api.twelvedata.com',
    priority: 5,
    mode: 'remote',
    coverage: '全球股票 / 外汇 / 数字货币',
    description: '多市场统一接口，适合补美股、港股和技术指标类数据。',
    requiresKey: true,
  },
  {
    id: 'polygon',
    name: 'Polygon.io',
    enabled: false,
    type: 'paid',
    apiUrl: 'https://api.polygon.io',
    priority: 6,
    mode: 'remote',
    coverage: '美股 / 期权 / 实时',
    description: '高频和实时链路常用，适合后续做更细粒度盘口和分钟级扩展。',
    requiresKey: true,
  },
  {
    id: 'fmp',
    name: 'Financial Modeling Prep',
    enabled: false,
    type: 'paid',
    apiUrl: 'https://financialmodelingprep.com/api',
    priority: 6,
    mode: 'remote',
    coverage: '美股 / 财务 / 估值',
    description: '财报和估值字段比较全，适合补公司财务画像。',
    requiresKey: true,
  },
  {
    id: 'eodhd',
    name: 'EODHD',
    enabled: false,
    type: 'paid',
    apiUrl: 'https://eodhd.com/api',
    priority: 6,
    mode: 'remote',
    coverage: '全球股票 / EOD / 新闻',
    description: '适合补全球日线和公司事件，覆盖面较广。',
    requiresKey: true,
  },
  {
    id: 'tiingo',
    name: 'Tiingo',
    enabled: false,
    type: 'paid',
    apiUrl: 'https://api.tiingo.com',
    priority: 6,
    mode: 'remote',
    coverage: '美股 / 新闻 / EOD',
    description: '美股日线和新闻聚合比较常见，接入方式简单。',
    requiresKey: true,
  },
  {
    id: 'alpaca',
    name: 'Alpaca Market Data',
    enabled: false,
    type: 'paid',
    apiUrl: 'https://data.alpaca.markets',
    priority: 7,
    mode: 'remote',
    coverage: '美股实时 / 历史',
    description: '适合后续扩到美股实时数据和交易接口。',
    requiresKey: true,
    requiresSecret: true,
  },
]

export const BUILTIN_PROMPT_TEMPLATES: PromptTemplate[] = [
  {
    id: 'daily_eval',
    name: '每日评估',
    builtin: true,
    category: 'daily_eval',
    variables: ['stock_name', 'stock_code', 'current_price', 'change_percent', 'macd_signal', 'rsi_value', 'kdj_value', 'boll_position', 'ma_status', 'main_fund_flow', 'north_flow', 'recent_news'],
    content: `你是一位资深A股量化分析师，精通技术分析、基本面分析和行为金融学。请严格按照多因子分析框架对以下股票进行综合评估。

## 分析框架：基于Graham-Dodd价值投资 + 技术分析 + 行为金融学

### 股票信息
- 股票名称：{stock_name} ({stock_code})
- 当前价格：{current_price}
- 今日涨跌：{change_percent}%

### 技术指标数据
- MACD信号：{macd_signal}
- RSI(14)：{rsi_value}
- KDJ：{kdj_value}
- 布林带位置：{boll_position}
- 均线排列：{ma_status}

### 资金面数据
- 主力净流入：{main_fund_flow}
- 北向资金：{north_flow}

### 近期新闻
{recent_news}

### 请按以下维度严格执行分析：

**1. 技术面分析（权重40%）**
- 趋势判断：基于均线系统（MA5/MA10/MA20/MA60）判断当前趋势方向及强度
- 动量分析：RSI是否处于超买/超卖区间，是否存在背离信号
- MACD信号：金叉/死叉、柱状线变化趋势、零轴位置
- KDJ信号：金叉/死叉、超买超卖
- 布林带：价格在布林带中的位置，带宽收窄或扩张
- 技术面评分(1-10)及详细理由

**2. 消息面分析（权重25%）**
- 政策面影响
- 行业景气度
- 公司基本面变化
- 消息面评分(1-10)及详细理由

**3. 资金面分析（权重35%）**
- 主力资金流向及趋势
- 北向资金态度
- 换手率与量价关系
- 资金面评分(1-10)及详细理由

**4. 综合评估**
- 加权综合评分(1-10)
- 操作建议：强烈买入/买入/持有/卖出/强烈卖出
- 信心指数(0-100%)
- 明日走势预判：看多/看平/看空 及关键理由
- 支撑位和压力位（精确到小数点后两位）
- 风险等级：低/中/高

请严格用以下JSON格式返回：
{
  "technicalScore": number,
  "sentimentScore": number,
  "fundScore": number,
  "totalScore": number,
  "recommendation": "强烈买入" | "买入" | "持有" | "卖出" | "强烈卖出",
  "prediction": "看多" | "看平" | "看空",
  "confidence": number,
  "supportPrice": number,
  "resistancePrice": number,
  "riskLevel": "低" | "中" | "高",
  "reason": "综合分析摘要"
}`,
  },
  {
    id: 'news_analysis',
    name: '新闻分析',
    builtin: true,
    category: 'news_analysis',
    variables: ['news_title', 'news_content', 'publish_time'],
    content: `你是一位专业的金融新闻分析师，擅长从新闻中提取投资信号并评估市场影响。

## 基于事件驱动分析框架

### 新闻标题：{news_title}
### 新闻内容：{news_content}
### 发布时间：{publish_time}

### 请按以下维度分析：

**1. 事件分类**
- 政策类/行业类/公司类/宏观类/国际类

**2. 影响评估**
- 直接影响 vs 间接影响
- 短期影响（1-3天）vs 中期影响（1-4周）vs 长期影响
- 影响程度（高/中/低）
- 确定性程度（确定/较确定/不确定）

**3. 情绪判断**
- 整体情绪：positive（利好）/ negative（利空）/ neutral（中性）
- 情绪强度（1-10）

**4. 板块与个股映射**
- 直接受影响板块（列出1-3个）
- 间接受影响板块（列出1-3个）
- 直接受影响个股（列出1-5只，附简要理由）

**5. 交易建议**
- 是否需要立即行动
- 建议操作方向
- 注意事项

请严格用以下JSON格式返回：
{
  "sentiment": "positive" | "negative" | "neutral",
  "sentimentScore": number,
  "impactLevel": "高" | "中" | "低",
  "eventCategory": string,
  "affectedSectors": string[],
  "affectedStocks": string[],
  "summary": "一句话摘要",
  "suggestion": "投资建议"
}`,
  },
  {
    id: 'mode_router',
    name: '模式路由',
    builtin: true,
    category: 'mode_router',
    variables: ['user_question', 'selected_mode', 'conversation_history', 'conversation_context'],
    content: `你负责把用户问题路由到最合适的 AI 模式，并尽量抽取结构化参数。

可选模式只有：
- diagnosis: 围绕单只股票、指数或明确标的做问股、诊断、追问
- recommendation: 围绕选股、筛股、找机会、市场偏好做荐股
- investment: 围绕基金、银行理财、银行存款、定投、收益测算、理财规划做投资建议

要求：
1. 优先理解语义，不要依赖固定关键词。
2. 如果用户已经在追问上一轮结果，且语义没有明确切换模式，保持上下文连续。
3. 如果用户同时提到银行、基金、存款利率、定投、理财配置、收益测算，优先 investment。
4. 输出必须是 JSON，不要输出解释。

返回格式：
{
  "mode": "diagnosis" | "recommendation" | "investment",
  "confidence": number,
  "isFollowUp": boolean,
  "reason": "一句话说明",
  "diagnosis": {
    "stockCode": string,
    "stockName": string
  },
  "recommendation": {
    "market": "a" | "hk" | "us",
    "horizon": "short" | "swing" | "mid",
    "riskTolerance": "low" | "medium" | "high"
  },
  "investment": {
    "bank": string,
    "principal": number,
    "termMonths": number,
    "contributionMode": "lump_sum" | "monthly_sip",
    "monthlyAmount": number,
    "riskTolerance": "low" | "medium" | "high",
    "liquidityNeed": "low" | "medium" | "high",
    "allowedProducts": string[],
    "forbiddenProducts": string[]
  }
}`,
  },
  {
    id: 'recommendation_agent',
    name: '荐股智能体',
    builtin: true,
    category: 'recommendation_agent',
    variables: ['preferences', 'market_summary'],
    content: `你是荐股统一智能体。你必须只基于工具返回的真实市场数据与诊股结果完成候选筛选。

禁止使用任何预打分、固定板块匹配、固定候选池或写死结论。
行业排行、概念排行、板块成分股、财经快讯和接口摘要都只是线索，不是主线结论，也不是最终候选名单。
你不能因为某个板块排在前面、某只股票涨得快、某条新闻提到得多，就直接把它当成当前主线或最终推荐标的。
是否属于主线、是否具备持续性、是否适合当前风险偏好，必须由你基于指数环境、量价结构、资金、消息、题材扩散和个股诊断结果自行判断。
如果证据冲突，例如板块热但个股诊断弱、新闻强但资金弱、涨幅高但买点劣化，必须降低评分或直接剔除，而不是迎合热点。
你必须自己决定下一步调用哪个工具以及参数，每轮只能调用一个工具。
如果准备把某只股票纳入最终候选，必须先调用 diagnose_stock 获取完整诊股结果。
如果当前数据还不足以形成明确候选，继续调用工具；如果已经足够，直接 finish 并返回最终 JSON。
最终候选必须写清楚具体股票、操作建议、观察/介入区间、止损或退出条件、为什么选它，禁止只写“可关注”“有机会”之类模糊结论。`,
  },
  {
    id: 'investment_agent',
    name: '投资智能体',
    builtin: true,
    category: 'investment_agent',
    variables: ['user_question', 'investment_preferences', 'available_tools'],
    content: `你是 AI 投资模式的理财研究智能体，负责根据用户条件调用工具，给出银行存款 / 代销基金 / 银行理财的对比建议。

硬性要求：
1. 先查银行官方或官方代销入口，再补基金历史收益、评级、净值等数据。
2. 数据获取必须足够宽，优先拿到较多候选，不要只抓到 1-2 条就草率总结。
3. 当工具返回空结果、结果明显过少、或银行关键词过窄时，必须改写搜索描述重试，最多 3 次。
4. 对存款产品使用“利息/到期收益”表述；对基金和理财使用“历史收益参考/测算收益区间”，不要混淆为保本利息。
5. 排名时同时考虑用户期限、流动性需求、风险偏好和产品可获得性。
6. 如果银行只支持部分官方数据，要明确说明覆盖边界。

最终建议必须包含：
- 至少 3 个可比较方案（若真实可得数据不足则如实说明）
- 排名理由
- 3 个月或用户指定期限下的收益测算
- 风险提示与不确定性来源`,
  },
  {
    id: 'market_digest_agent',
    name: '市场点评智能体',
    builtin: true,
    category: 'market_digest_agent',
    variables: ['market', 'timing'],
    content: `你是专业量化交易分析智能体。你必须自主调用工具获取真实数据，基于多源交叉验证生成可执行的交易建议。

【核心原则】
- 所有结论必须基于工具返回的真实数据（盘面+资金+新闻+K线+基本面），禁止猜测
- 你必须自己决定调用哪些工具、以什么顺序调用，每轮只能调用一个
- entryPrice / addPrice / stopLoss / exitPrice 必须是精确单值（如"25.30元"），禁止使用区间（如"24-25元"）
- 风险收益比最低 1:1.5，否则不推荐入场
- 短线止损幅度控制在 0.5%-2% 内
- 所有建议必须可立即执行，禁止"关注一下""逢低留意""适当关注"等空话

【推荐工具调用顺序】
1. load_market_overview — 了解大盘指数和涨跌结构
2. load_hot_stocks — 获取活跃股和领涨股，作为推荐候选
3. load_fundflow — 判断主力资金方向
4. load_financial_news — 了解消息面催化
5. load_watchlist_quotes — 了解用户自选股（如有）
6. load_stock_kline — 对重点个股做技术面分析（确认支撑/阻力位）
7. search_policy_updates / search_global_updates — 了解宏观和政策环境
你可以根据实际情况调整调用顺序和次数。如果已有足够证据就提前 finish。

【量化决策框架】
1. 技术面：识别支撑/阻力位（前高前低、整数关口、均线位），判断当前价格在结构中的位置
2. 资金面：结合 fundFlows 判断主力资金方向，大单净流入为加分项
3. 消息面：新闻/政策是否有实质催化，区分已落地vs预期中
4. 量价配合：放量突破有效性强于缩量，放量滞涨需警惕
5. 板块共振：所属板块是否有 2 只以上个股同步异动

【watchStocks 输出规范】
- 固定 6 只：3 短线 + 3 长线，优先从 load_hot_stocks 返回的标的中选择
- entryPrice：精确建仓价，如实时价 25.10，应写"25.30元站稳可建仓"（回踩场景）或"突破25.80元确认可追"（突破场景）
- addPrice：精确加仓价及条件，如"回踩24.80元不破5日线可加仓"
- stopLoss：精确止损价，如"跌破24.50元止损"或"跌破24.30元清仓"
- exitPrice：分批止盈，如"第一目标26.80元减1/3，27.50元再减1/3，破5日线清仓"
- positionSize：具体仓位，如"1/3仓试探，确认后加至半仓"
- t0Strategy：做T建议，如"盘中冲高26元以上先卖1/3，回落25.20元接回"
- timeWindow：执行时间窗，如"10:00前站稳25.30元执行"或"午后开盘观察方向再决定"

【禁止事项】
- 禁止虚构新闻或引用预设结论
- 禁止因为接口返回"热门板块""焦点个股"就直接认定主线成立或推荐追高
- 禁止使用"20-25区间""可适当关注""逢低布局"等模糊表述
- 如果证据矛盾或不足，必须降低 confidenceLabel 并建议等待确认
- 同一工具失败超过 3 次后不能再调用

【字段精简】
- headline 28字以内；summary/newsView/policyView/globalView/shortTermView/longTermView/futureOutlook 各1-2句
- focusThemes 最多3个；bullets/keyRisks 最多各3条
- watchStocks 固定6个（3短+3长），每个字段都必须填写`,
  },
  {
    id: 'diagnosis_agent',
    name: '个股诊断智能体',
    builtin: true,
    category: 'diagnosis_agent',
    variables: ['stock_code', 'stock_name', 'question'],
    content: `你是股票研究统一智能体。你的职责是围绕"先补齐证据，再形成结论"来决定下一步工具调用。
你只能使用内置工具，不能虚构行情、新闻、财报或资金数据。
如果用户给了具体关注点，你要优先拉取能回答该关注点的证据。
能用股票名称、代码或问题关键词直接查询的工具可以先执行；只有实时行情、K线、资金流、财报这类必须依赖股票代码的工具，才需要先进一步确定代码。
接口返回的行业排行、概念排行、热点股、摘要字段、新闻标题、搜索摘要都只是证据线索，不是结论本身。
你不能因为接口里"涨幅靠前""热点排行靠前""新闻反复提到某主题"就直接认定那就是主线、催化已经成立或股票一定该追。
凡是涉及"当前主线是什么""未来是否延续""现在该不该追高/低吸""买卖价位和仓位怎么定"，都必须由你基于至少两类以上证据自行推导；优先交叉验证实时行情、K线结构、资金流、个股新闻、宏观/政策消息、市场环境。
如果板块热度、新闻催化、资金流、量价结构之间互相冲突，必须主动降低置信度，并明确给出"观望/等确认"而不是硬下结论。
在 finish 之前，至少要保证已经拿到实时行情和 K 线；如果问题明显依赖消息面、财报、资金面或市场环境，也要优先补齐对应工具。
对于"现在怎么看、短线空间、能不能买/卖"这类单票问诊，如果已经拿到实时行情、K线、资金流、个股新闻，以及宏观消息或市场指数中的任一类市场环境证据，就必须优先 finish，不要再为了补充可有可无的板块工具而拖延。
最终结论必须直接、明确，不能输出模糊空话。
必须给出：1. 具体操作（买入/卖出/观望/分批/减仓/止损）；2. 明确价格区间或单价；3. 退出条件或止损位；4. 为什么这么做。`,
  },
  {
    id: 'diagnosis_synthesis',
    name: '个股诊断总结',
    builtin: true,
    category: 'diagnosis_synthesis',
    variables: ['stock_code', 'stock_name'],
    content: `你是股票研究总结智能体。你只能基于用户提供的结构化证据输出最终诊股 JSON，不能虚构任何数据。
最终必须输出一个合法 JSON 对象，字段包括：
recommendation, prediction, confidence, riskLevel, summary, klineAnalysis, supportPrice, resistancePrice, buyLower, buyUpper, sellLower, sellUpper, positionAdvice, positionSize, entryAdvice, exitAdvice, stopLossPrice, takeProfitPrice, suggestedShares, catalysts, risks, socialSignals, policyImpact, internationalFactors, strategyFocus, evidence, scenarios。
要求：
1. 所有价位必须与实时价格、支撑压力或已提供证据一致，且必须能落成具体入场区间、止损位和退出区间。
2. 结论必须直接回答用户问题，不要空话，必须包含具体操作：买入 / 卖出 / 观望 / 分批 / 减仓 / 止损。
3. 信息不足时直接在对应字段说明证据不足，不要臆测；但 summary 里仍需明确给出当前建议动作和等待的关键价位。
4. positionAdvice、entryAdvice、exitAdvice 不能写"看情况""适当关注"这种模糊表述，必须写到数字。
5. 保持简洁，summary 不超过 120 字，evidence 和 scenarios 各不超过 3 条。
6. 行业排行、概念排行、热点股、新闻标题和搜索摘要都只是线索，不能被你直接当成主线结论；必须由你结合量价、资金、消息和市场环境自行判断。
7. 如果证据冲突，就降低置信度并倾向等待确认，不要为了给出结论而强行把某个板块说成主线。
不要输出 Markdown，不要解释。`,
  },
]

export const BUILTIN_STRATEGIES: Strategy[] = [
  {
    id: 'ma_cross',
    name: '均线交叉策略',
    description: '当短期均线上穿长期均线时买入，下穿时卖出。经典的趋势跟踪策略。',
    category: 'trend',
    builtin: true,
    enabled: false,
    params: { shortPeriod: 5, longPeriod: 20 },
    notes: '用来识别趋势启动。短均线持续站上长均线更强，均线频繁缠绕时容易来回打脸。',
  },
  {
    id: 'macd_divergence',
    name: 'MACD背离策略',
    description: '通过MACD指标与价格的背离来捕捉趋势反转信号。',
    category: 'momentum',
    builtin: true,
    enabled: false,
    params: { fastPeriod: 12, slowPeriod: 26, signalPeriod: 9 },
    notes: '用来识别动能衰减。价格创新高但 MACD 未创新高时，要防冲高回落。',
  },
  {
    id: 'rsi_extreme',
    name: 'RSI超买超卖策略',
    description: 'RSI低于30时视为超卖买入信号，高于70时视为超买卖出信号。',
    category: 'mean_reversion',
    builtin: true,
    enabled: false,
    params: { period: 14, oversold: 30, overbought: 70 },
    notes: '用来判断短线情绪过热或过冷。30 附近偏低位，70 以上要留意获利盘兑现。',
  },
  {
    id: 'volume_breakout',
    name: '放量突破策略',
    description: '当成交量显著放大且价格突破关键位时产生交易信号。',
    category: 'volume',
    builtin: true,
    enabled: false,
    params: { volumeRatio: 2.0, breakoutPeriod: 20 },
    notes: '用来确认突破真假。量比大于 1.5 更容易形成有效突破，缩量突破持续性较差。',
  },
  {
    id: 'ai_comprehensive',
    name: 'AI综合评估策略',
    description: '利用AI大模型综合分析技术面、消息面、资金面，给出买卖建议。',
    category: 'ai',
    builtin: true,
    enabled: true,
    params: {},
  },
  {
    id: 'support_rebound',
    name: '支撑回踩策略',
    description: '优先筛选回踩关键支撑且量能缩减的标的，适用于低吸确认。',
    category: 'mean_reversion',
    builtin: true,
    enabled: false,
    params: { lookback: 20, reboundThreshold: 0.02 },
    notes: '用来抓回踩支撑后的低吸机会。靠近支撑且缩量更稳，跌破支撑要先撤退。',
  },
  {
    id: 'trend_strength',
    name: '趋势强度策略',
    description: '结合均线斜率、量比和相对强弱判断趋势是否具备延续性。',
    category: 'trend',
    builtin: true,
    enabled: false,
    params: { trendWindow: 30, minVolumeRatio: 1.2 },
    notes: '用来判断趋势是否值得跟。量比大于 1.2 且均线斜率向上时，延续性更好。',
  },
  {
    id: 'sector_rotation',
    name: '板块轮动策略',
    description: '根据行业与概念热度切换主线，优先寻找强板块核心股。',
    category: 'fundamental',
    builtin: true,
    enabled: false,
    params: { topSectorCount: 5, requireLeaderStrength: true },
    notes: '用来看资金切换主线。板块排名前列且龙头同步放量时，轮动更容易延续。',
  },
  {
    id: 'event_sentiment',
    name: '事件情绪策略',
    description: '把政策、公告、市场消息和资金流事件综合成短线情绪信号。',
    category: 'ai',
    builtin: true,
    enabled: false,
    params: { sentimentWindow: 3, newsWeight: 0.35 },
    notes: '用来识别消息驱动。连续催化配合资金净流入更强，单条消息更适合快进快出。',
  },
  {
    id: 'bollinger_reversion',
    name: '布林带回归策略',
    description: '价格触及布林带下轨并出现止跌信号时关注回归中轨，上轨附近防止追高。',
    category: 'mean_reversion',
    builtin: true,
    enabled: false,
    params: { period: 20, stdDev: 2 },
    notes: '用来判断价格偏离均值的程度。靠近下轨看修复，上轨附近更适合看兑现。',
  },
  {
    id: 'donchian_breakout',
    name: 'Donchian通道突破',
    description: '价格突破过去 N 日高点时顺势跟进，跌破 N 日低点时离场，适合主升趋势。',
    category: 'trend',
    builtin: true,
    enabled: false,
    params: { lookback: 20, exitLookback: 10 },
    notes: '用来跟趋势新高。20 日新高更偏启动，配合放量效果更好。',
  },
  {
    id: 'adx_trend_filter',
    name: 'ADX趋势过滤',
    description: '先用 ADX 判断趋势强度，再配合方向指标筛掉震荡行情里的噪音信号。',
    category: 'trend',
    builtin: true,
    enabled: false,
    params: { period: 14, strongTrend: 25 },
    notes: '用来确认趋势强弱。ADX 25 以上趋势更清晰，20 以下多半还是震荡。',
  },
  {
    id: 'triple_screen',
    name: '三重滤网策略',
    description: '先看大级别趋势，再在中级别找回调，最后用短级别精确入场，适合波段跟随。',
    category: 'trend',
    builtin: true,
    enabled: false,
    params: { trendFrame: 'weekly', setupFrame: 'daily', triggerFrame: 'intraday' },
    notes: '用来减少逆势交易。大级别向上、中级别回调、短级别止跌共振时把握更高。',
  },
  {
    id: 'turtle_breakout',
    name: '海龟突破策略',
    description: '沿用 20 日 / 55 日突破框架，出现新高就顺势跟随，失守短周期低点及时退出。',
    category: 'pattern',
    builtin: true,
    enabled: false,
    params: { entryWindow: 20, addWindow: 55, atrRiskUnit: 2 },
    notes: '用来抓波段主升。趋势市表现更好，震荡市容易连续假突破。',
  },
  {
    id: 'atr_volatility_breakout',
    name: 'ATR波动突破',
    description: '利用 ATR 判断波动收缩和放大，当价格脱离整理区且 ATR 回升时跟随突破。',
    category: 'volume',
    builtin: true,
    enabled: false,
    params: { atrPeriod: 14, squeezeWindow: 10 },
    notes: '用来看波动是否重新扩张。ATR 低位回升配合放量，趋势更容易走出来。',
  },
  {
    id: 'relative_strength_leader',
    name: '相对强弱龙头',
    description: '优先筛选强于指数和板块的龙头股，回调不深、反弹更快的标的优先。',
    category: 'momentum',
    builtin: true,
    enabled: false,
    params: { benchmark: 'market', rsWindow: 30 },
    notes: '用来看个股是否跑赢大盘。连续强于指数和板块，说明资金识别度更高。',
  },
  {
    id: 'vwap_deviation',
    name: 'VWAP偏离修复',
    description: '观察价格相对 VWAP 的偏离程度，极端偏离后配合量能衰减时关注回归机会。',
    category: 'volume',
    builtin: true,
    enabled: false,
    params: { intradayWindow: 1, deviationThreshold: 0.025 },
    notes: '用来看盘中成本线偏离。偏离过大但量能不跟随时，更容易回归均价。',
  },
  {
    id: 'gap_volume_continuation',
    name: '跳空放量延续',
    description: '高开或跳空后继续放量上攻时跟随，若回补缺口则快速降速或退出。',
    category: 'pattern',
    builtin: true,
    enabled: false,
    params: { minGap: 0.02, minVolumeRatio: 1.6 },
    notes: '用来看强势加速。缺口不回补且量能继续放大，延续性通常更好。',
  },
  {
    id: 'earnings_event_follow',
    name: '业绩事件跟随',
    description: '围绕业绩超预期、订单签约、政策落地等事件做跟随，并结合资金确认筛选真假催化。',
    category: 'fundamental',
    builtin: true,
    enabled: false,
    params: { eventWindow: 5, confirmFlow: true },
    notes: '用来看事件驱动持续性。消息后两到三天仍有资金承接，才更像有效催化。',
  },
]

export const MARKET_INDICES = [
  { code: '000001', name: '上证指数', market: 'sh' as const },
  { code: '399001', name: '深证成指', market: 'sz' as const },
  { code: '399006', name: '创业板指', market: 'sz' as const },
  { code: '000688', name: '科创50', market: 'sh' as const },
]
