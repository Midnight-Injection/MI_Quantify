import type { AiProvider } from '@/types/ai'
import type { DataSource, SearchProvider } from '@/types/settings'
import type { PromptTemplate, Strategy } from '@/types/strategy'

export const APP_NAME = 'MI Quantify'
export const PYTHON_SIDECAR_PORT = 18911
export const PYTHON_SIDECAR_URL = `http://localhost:${PYTHON_SIDECAR_PORT}`

export const NAV_ITEMS = [
  { path: '/', name: 'home', label: '首页', icon: 'Home' },
  { path: '/market', name: 'market', label: '个股行情', icon: 'BarChart3' },
  { path: '/monitor', name: 'monitor', label: '关注监听', icon: 'BellRing' },
  { path: '/analysis', name: 'analysis', label: '个股分析', icon: 'CandlestickChart' },
  { path: '/ask', name: 'ask', label: 'AI问股', icon: 'MessageSquareText' },
  { path: '/strategy', name: 'strategy', label: '策略', icon: 'BrainCircuit' },
  { path: '/settings', name: 'settings', label: '设置', icon: 'Settings' },
] as const

export const AI_PROVIDER_PRESETS: Omit<AiProvider, 'apiKey'>[] = [
  {
    id: 'deepseek',
    name: 'DeepSeek',
    enabled: false,
    apiUrl: 'https://api.deepseek.com/v1/chat/completions',
    model: 'deepseek-chat',
    maxTokens: 4096,
    temperature: 0.7,
  },
  {
    id: 'zhipu',
    name: '智谱 GLM',
    enabled: false,
    apiUrl: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
    model: 'glm-4',
    maxTokens: 4096,
    temperature: 0.7,
  },
  {
    id: 'qwen',
    name: '通义千问',
    enabled: false,
    apiUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
    model: 'qwen-plus',
    maxTokens: 4096,
    temperature: 0.7,
  },
  {
    id: 'chatgpt',
    name: 'ChatGPT',
    enabled: false,
    apiUrl: 'https://api.openai.com/v1/chat/completions',
    model: 'gpt-4o',
    maxTokens: 4096,
    temperature: 0.7,
  },
  {
    id: 'doubao',
    name: '豆包',
    enabled: false,
    apiUrl: 'https://ark.cn-beijing.volces.com/api/v3/chat/completions',
    model: 'doubao-pro-32k',
    maxTokens: 4096,
    temperature: 0.7,
  },
  {
    id: 'moonshot',
    name: 'Kimi',
    enabled: false,
    apiUrl: 'https://api.moonshot.cn/v1/chat/completions',
    model: 'moonshot-v1-8k',
    maxTokens: 4096,
    temperature: 0.7,
  },
  {
    id: 'custom',
    name: '自定义',
    enabled: false,
    apiUrl: '',
    model: '',
    maxTokens: 4096,
    temperature: 0.7,
  },
]

export const SEARCH_PROVIDER_PRESETS: Omit<SearchProvider, 'apiKey'>[] = [
  {
    id: 'zhipu-web-search',
    name: '智谱 Web Search',
    enabled: false,
    apiUrl: '',
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
    id: 'buy_signal',
    name: '买入信号',
    builtin: true,
    category: 'buy_signal',
    variables: ['stock_name', 'stock_code', 'technical_state', 'news_sentiment'],
    content: `你是一位专业的量化交易策略师，擅长基于多时间框架分析和风险管理来识别高质量的交易机会。请基于以下数据判断买入信号。

## 基于Alexander Elder三重滤网分析框架

### 股票：{stock_name} ({stock_code})
### 当前技术状态：{technical_state}
### 近期新闻情绪：{news_sentiment}

### 第一重滤网：长期趋势（周线级别）
- 判断当前是否处于上升趋势中
- 20周均线方向

### 第二重滤网：中期信号（日线级别）
- 寻找回调买点（趋势中的回调）
- MACD、RSI等指标是否出现买入信号
- 成交量是否配合

### 第三重滤网：短期确认（小时级别）
- 精确入场时机
- 关键支撑位确认

### 请输出：
1. 是否存在买入信号（是/否）
2. 信号强度（强/中/弱）
3. 综合置信度（0-100%）
4. 建议买入价位区间
5. 止损位（基于ATR或关键支撑位）
6. 第一目标价（风险回报比1:2）
7. 第二目标价（风险回报比1:3）
8. 建议仓位比例（基于Kelly公式，不超过30%）
9. 持仓周期建议
10. 三个关键风险提示

请用JSON格式返回。`,
  },
  {
    id: 'sell_signal',
    name: '卖出信号',
    builtin: true,
    category: 'sell_signal',
    variables: ['stock_name', 'stock_code', 'technical_state', 'cost_price', 'profit_percent'],
    content: `你是一位严谨的风险管理专家，基于John Paul Smith的卖出纪律体系来分析卖出时机。

## 基于系统化卖出决策框架

### 股票：{stock_name} ({stock_code})
### 当前技术状态：{technical_state}
### 持仓成本：{cost_price}
### 当前盈亏：{profit_percent}%

### 分析维度：

**1. 止损触发检查**
- 是否触及预设止损位
- 移动止损是否触发（trailing stop）

**2. 技术卖出信号**
- 趋势是否反转（均线死叉、跌破关键支撑）
- 是否出现顶部形态（头肩顶、双顶等）
- 量价是否背离

**3. 资金面变化**
- 主力是否明显出逃
- 大单净流出是否持续

**4. 情绪面变化**
- 是否出现过度乐观（反向指标）
- 是否有利空消息

### 请输出：
1. 操作建议（全部卖出/减仓50%/减仓30%/继续持有）
2. 紧急程度（立即/当日/观察3天）
3. 卖出理由（按重要性排序）
4. 如果继续持有，新的止损位
5. 如果减仓，减仓比例及理由
6. 后续关注要点
7. 最大的风险点

请用JSON格式返回。`,
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
]

export const BUILTIN_STRATEGIES: Strategy[] = [
  {
    id: 'ma_cross',
    name: '均线交叉策略',
    description: '当短期均线上穿长期均线时买入，下穿时卖出。经典的趋势跟踪策略。',
    category: 'trend',
    builtin: true,
    enabled: true,
    params: { shortPeriod: 5, longPeriod: 20 },
    notes: '用来识别趋势启动。短均线持续站上长均线更强，均线频繁缠绕时容易来回打脸。',
  },
  {
    id: 'macd_divergence',
    name: 'MACD背离策略',
    description: '通过MACD指标与价格的背离来捕捉趋势反转信号。',
    category: 'momentum',
    builtin: true,
    enabled: true,
    params: { fastPeriod: 12, slowPeriod: 26, signalPeriod: 9 },
    notes: '用来识别动能衰减。价格创新高但 MACD 未创新高时，要防冲高回落。',
  },
  {
    id: 'rsi_extreme',
    name: 'RSI超买超卖策略',
    description: 'RSI低于30时视为超卖买入信号，高于70时视为超买卖出信号。',
    category: 'mean_reversion',
    builtin: true,
    enabled: true,
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
    enabled: true,
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
    description: '把政策、公告、社会面消息和资金流事件综合成短线情绪信号。',
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
    enabled: true,
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
