export type MarketCode = 'a' | 'hk' | 'us'

type MarketPhase = 'pre_market' | 'trading' | 'midday_break' | 'post_market' | 'holiday_closed'
type ClosureReason = 'holiday' | 'weekend'

interface MarketSessionWindow {
  end: string
  label: string
  start: string
}

interface HolidayRange {
  end: string
  label: string
  start: string
}

interface MarketSchedule {
  label: string
  timezone: string
  windows: MarketSessionWindow[]
}

export interface MarketSessionContext {
  analysisFocus: string
  closureLabel: string
  closureReason: ClosureReason | null
  currentDate: string
  currentTime: string
  isTradingDay: boolean
  market: MarketCode
  marketLabel: string
  nextOpenAt: string
  nextOpenDate: string
  nextOpenTime: string
  phase: MarketPhase
  phaseLabel: string
  targetLabel: string
  timezone: string
}

export interface MarketSessionPromptRules {
  actionHorizon: string
  firstSentenceRequirement: string
  forbiddenPhrases: string[]
  mustFocus: string[]
  phase: string
  primaryWindow: string
}

const MARKET_SCHEDULES: Record<MarketCode, MarketSchedule> = {
  a: {
    label: 'A股',
    timezone: 'Asia/Shanghai',
    windows: [
      { start: '09:30', end: '11:30', label: '上午盘' },
      { start: '13:00', end: '15:00', label: '下午盘' },
    ],
  },
  hk: {
    label: '港股',
    timezone: 'Asia/Hong_Kong',
    windows: [
      { start: '09:30', end: '12:00', label: '上午盘' },
      { start: '13:00', end: '16:00', label: '下午盘' },
    ],
  },
  us: {
    label: '美股',
    timezone: 'America/New_York',
    windows: [
      { start: '09:30', end: '16:00', label: '常规交易时段' },
    ],
  },
}

const HOLIDAY_RANGES: Record<MarketCode, Record<number, HolidayRange[]>> = {
  a: {
    2025: [
      { label: '元旦休市', start: '2025-01-01', end: '2025-01-01' },
      { label: '春节休市', start: '2025-01-28', end: '2025-02-04' },
      { label: '清明节休市', start: '2025-04-04', end: '2025-04-06' },
      { label: '劳动节休市', start: '2025-05-01', end: '2025-05-05' },
      { label: '端午节休市', start: '2025-05-31', end: '2025-06-02' },
      { label: '国庆节/中秋节休市', start: '2025-10-01', end: '2025-10-08' },
    ],
    2026: [
      { label: '元旦休市', start: '2026-01-01', end: '2026-01-03' },
      { label: '春节休市', start: '2026-02-15', end: '2026-02-23' },
      { label: '清明节休市', start: '2026-04-04', end: '2026-04-06' },
      { label: '劳动节休市', start: '2026-05-01', end: '2026-05-05' },
      { label: '端午节休市', start: '2026-06-19', end: '2026-06-21' },
      { label: '中秋节休市', start: '2026-09-25', end: '2026-09-27' },
      { label: '国庆节休市', start: '2026-10-01', end: '2026-10-07' },
    ],
  },
  hk: {
    2025: [
      { label: '元旦', start: '2025-01-01', end: '2025-01-01' },
      { label: '农历新年假期', start: '2025-01-29', end: '2025-01-31' },
      { label: '清明节', start: '2025-04-04', end: '2025-04-04' },
      { label: '耶稣受难节', start: '2025-04-18', end: '2025-04-18' },
      { label: '复活节星期一', start: '2025-04-21', end: '2025-04-21' },
      { label: '劳动节', start: '2025-05-01', end: '2025-05-01' },
      { label: '佛诞', start: '2025-05-05', end: '2025-05-05' },
      { label: '香港特别行政区成立纪念日', start: '2025-07-01', end: '2025-07-01' },
      { label: '国庆日', start: '2025-10-01', end: '2025-10-01' },
      { label: '中秋节翌日', start: '2025-10-07', end: '2025-10-07' },
      { label: '重阳节', start: '2025-10-29', end: '2025-10-29' },
      { label: '圣诞节', start: '2025-12-25', end: '2025-12-25' },
      { label: '圣诞节后首个周日', start: '2025-12-26', end: '2025-12-26' },
    ],
    2026: [
      { label: '元旦', start: '2026-01-01', end: '2026-01-01' },
      { label: '农历新年假期', start: '2026-02-17', end: '2026-02-19' },
      { label: '耶稣受难节', start: '2026-04-03', end: '2026-04-03' },
      { label: '清明节补假', start: '2026-04-06', end: '2026-04-06' },
      { label: '复活节星期一补假', start: '2026-04-07', end: '2026-04-07' },
      { label: '劳动节', start: '2026-05-01', end: '2026-05-01' },
      { label: '佛诞补假', start: '2026-05-25', end: '2026-05-25' },
      { label: '端午节', start: '2026-06-19', end: '2026-06-19' },
      { label: '香港特别行政区成立纪念日', start: '2026-07-01', end: '2026-07-01' },
      { label: '国庆日', start: '2026-10-01', end: '2026-10-01' },
      { label: '重阳节补假', start: '2026-10-19', end: '2026-10-19' },
      { label: '圣诞节', start: '2026-12-25', end: '2026-12-25' },
    ],
  },
  us: {
    2025: [
      { label: 'New Year’s Day', start: '2025-01-01', end: '2025-01-01' },
      { label: 'Martin Luther King Jr. Day', start: '2025-01-20', end: '2025-01-20' },
      { label: 'Washington’s Birthday', start: '2025-02-17', end: '2025-02-17' },
      { label: 'Good Friday', start: '2025-04-18', end: '2025-04-18' },
      { label: 'Memorial Day', start: '2025-05-26', end: '2025-05-26' },
      { label: 'Juneteenth', start: '2025-06-19', end: '2025-06-19' },
      { label: 'Independence Day', start: '2025-07-04', end: '2025-07-04' },
      { label: 'Labor Day', start: '2025-09-01', end: '2025-09-01' },
      { label: 'Thanksgiving Day', start: '2025-11-27', end: '2025-11-27' },
      { label: 'Christmas Day', start: '2025-12-25', end: '2025-12-25' },
    ],
    2026: [
      { label: 'New Year’s Day', start: '2026-01-01', end: '2026-01-01' },
      { label: 'Martin Luther King Jr. Day', start: '2026-01-19', end: '2026-01-19' },
      { label: 'Washington’s Birthday', start: '2026-02-16', end: '2026-02-16' },
      { label: 'Good Friday', start: '2026-04-03', end: '2026-04-03' },
      { label: 'Memorial Day', start: '2026-05-25', end: '2026-05-25' },
      { label: 'Juneteenth', start: '2026-06-19', end: '2026-06-19' },
      { label: 'Independence Day (observed)', start: '2026-07-03', end: '2026-07-03' },
      { label: 'Labor Day', start: '2026-09-07', end: '2026-09-07' },
      { label: 'Thanksgiving Day', start: '2026-11-26', end: '2026-11-26' },
      { label: 'Christmas Day', start: '2026-12-25', end: '2026-12-25' },
    ],
  },
}

function normalizeMarket(input: string): MarketCode {
  const normalized = String(input || '').trim().toLowerCase()
  if (normalized === 'hk' || normalized === '港股') return 'hk'
  if (normalized === 'us' || normalized === '美股') return 'us'
  return 'a'
}

function getZonedDateParts(value: Date, timezone: string) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    minute: '2-digit',
    hour: '2-digit',
    second: '2-digit',
    hour12: false,
  })
  const partMap = new Map(formatter.formatToParts(value).map((part) => [part.type, part.value]))
  const year = partMap.get('year') || '1970'
  const month = partMap.get('month') || '01'
  const day = partMap.get('day') || '01'
  const hour = partMap.get('hour') || '00'
  const minute = partMap.get('minute') || '00'
  const weekday = partMap.get('weekday') || 'Mon'
  return {
    date: `${year}-${month}-${day}`,
    hour,
    minute,
    time: `${hour}:${minute}`,
    weekday,
    year: Number(year),
  }
}

function getWeekendFlag(weekday: string) {
  return weekday === 'Sat' || weekday === 'Sun'
}

function timeToMinutes(value: string) {
  const [hour, minute] = value.split(':').map((item) => Number(item))
  return hour * 60 + minute
}

function buildHolidayMap(market: MarketCode, year: number) {
  const ranges = HOLIDAY_RANGES[market][year] || []
  return ranges.reduce<Map<string, string>>((map, range) => {
    const cursor = new Date(`${range.start}T00:00:00Z`)
    const end = new Date(`${range.end}T00:00:00Z`)
    while (cursor.getTime() <= end.getTime()) {
      map.set(cursor.toISOString().slice(0, 10), range.label)
      cursor.setUTCDate(cursor.getUTCDate() + 1)
    }
    return map
  }, new Map())
}

function getHolidayLabel(market: MarketCode, date: string, year: number) {
  return buildHolidayMap(market, year).get(date) || ''
}

function isTradingDate(market: MarketCode, date: string, weekday: string, year: number) {
  if (getWeekendFlag(weekday)) return false
  return !getHolidayLabel(market, date, year)
}

function findNextOpen(market: MarketCode, reference: Date, phase: MarketPhase, currentDate: string) {
  const schedule = MARKET_SCHEDULES[market]
  const parts = getZonedDateParts(reference, schedule.timezone)
  const firstWindow = schedule.windows[0]
  const secondWindow = schedule.windows[1]

  if (phase === 'pre_market') {
    return `${currentDate} ${firstWindow.start}`
  }

  if (phase === 'midday_break' && secondWindow) {
    return `${currentDate} ${secondWindow.start}`
  }

  for (let offset = 1; offset <= 40; offset += 1) {
    const probe = new Date(reference.getTime() + offset * 24 * 60 * 60 * 1000)
    const probeParts = getZonedDateParts(probe, schedule.timezone)
    if (isTradingDate(market, probeParts.date, probeParts.weekday, probeParts.year)) {
      return `${probeParts.date} ${firstWindow.start}`
    }
  }

  return `${parts.date} ${firstWindow.start}`
}

function resolvePhaseLabel(phase: MarketPhase) {
  switch (phase) {
    case 'pre_market':
      return '盘前'
    case 'trading':
      return '盘中'
    case 'midday_break':
      return '午间休市'
    case 'post_market':
      return '盘后'
    case 'holiday_closed':
      return '休市'
  }
}

function resolveTargetLabel(phase: MarketPhase) {
  switch (phase) {
    case 'pre_market':
      return '今日走势'
    case 'trading':
      return '剩余交易时段与下一交易日'
    case 'midday_break':
      return '午后走势'
    case 'post_market':
      return '下一交易日走势'
    case 'holiday_closed':
      return '下一次开盘日走势'
  }
}

function resolveAnalysisFocus(marketLabel: string, phase: MarketPhase, nextOpenAt: string) {
  switch (phase) {
    case 'pre_market':
      return `当前处于${marketLabel}盘前，重点判断今日开盘后的强弱方向、最值得跟踪的主线板块，以及开盘30-90分钟内的执行策略。`
    case 'trading':
      return `当前处于${marketLabel}盘中，重点判断剩余交易时段是否延续、是否发生分歧转一致或冲高回落，并给出尾盘与下一交易日的具体应对。`
    case 'midday_break':
      return `当前处于${marketLabel}午间休市，重点复盘上午盘的量价、板块和龙头表现，明确判断午后最可能走强或走弱的板块与执行策略。`
    case 'post_market':
      return `当前处于${marketLabel}盘后，重点基于收盘结构、量能、消息与板块轮动，判断下一交易日更可能高开走强、冲高回落还是继续承压。`
    case 'holiday_closed':
      return `当前处于${marketLabel}休市阶段，下一次预计开盘时间为 ${nextOpenAt}。重点预测下一次开盘日及其后2-5个交易日的方向、主线板块和预案。`
  }
}

export function getMarketSessionContext(input: string, reference = new Date()): MarketSessionContext {
  const market = normalizeMarket(input)
  const schedule = MARKET_SCHEDULES[market]
  const parts = getZonedDateParts(reference, schedule.timezone)
  const holidayLabel = getHolidayLabel(market, parts.date, parts.year)
  const firstWindow = schedule.windows[0]
  const lastWindow = schedule.windows[schedule.windows.length - 1]
  const currentMinutes = timeToMinutes(parts.time)
  let phase: MarketPhase = 'post_market'
  let closureReason: ClosureReason | null = null

  if (!isTradingDate(market, parts.date, parts.weekday, parts.year)) {
    phase = 'holiday_closed'
    closureReason = holidayLabel ? 'holiday' : 'weekend'
  } else if (currentMinutes < timeToMinutes(firstWindow.start)) {
    phase = 'pre_market'
  } else if (schedule.windows.some((window) => currentMinutes >= timeToMinutes(window.start) && currentMinutes < timeToMinutes(window.end))) {
    phase = 'trading'
  } else if (
    schedule.windows.length > 1
    && currentMinutes >= timeToMinutes(schedule.windows[0].end)
    && currentMinutes < timeToMinutes(schedule.windows[1].start)
  ) {
    phase = 'midday_break'
  } else if (currentMinutes >= timeToMinutes(lastWindow.end)) {
    phase = 'post_market'
  }

  const nextOpenAt = findNextOpen(market, reference, phase, parts.date)
  const [nextOpenDate, nextOpenTime] = nextOpenAt.split(' ')
  const closureLabel = closureReason === 'holiday'
    ? `${holidayLabel || schedule.label}休市`
    : closureReason === 'weekend'
      ? '周末休市'
      : ''

  return {
    analysisFocus: resolveAnalysisFocus(schedule.label, phase, nextOpenAt),
    closureLabel,
    closureReason,
    currentDate: parts.date,
    currentTime: parts.time,
    isTradingDay: closureReason === null,
    market,
    marketLabel: schedule.label,
    nextOpenAt,
    nextOpenDate,
    nextOpenTime,
    phase,
    phaseLabel: resolvePhaseLabel(phase),
    targetLabel: resolveTargetLabel(phase),
    timezone: schedule.timezone,
  }
}

export function buildDigestTimingPrompt(session: MarketSessionContext) {
  const rules = buildSessionPromptRules(session)
  const closureLine = session.closureReason
    ? `当前为${session.closureLabel}，下一次开盘时间：${session.nextOpenAt}。`
    : `当前${session.marketLabel}本地时间 ${session.currentDate} ${session.currentTime}（${session.timezone}），处于${session.phaseLabel}。`

  return [
    `${closureLine}`,
    session.analysisFocus,
    `本轮点评优先覆盖：${rules.mustFocus.join('、')}。`,
    `时段约束：${rules.firstSentenceRequirement}`,
    `禁止出现与当前时段冲突的措辞：${rules.forbiddenPhrases.join('、')}。`,
    '你必须明确点名 1-3 个最值得跟踪的板块/主题，并给出每个板块对应的观察理由或操作方式。',
    '禁止把盘前、盘中、盘后、休市时段混着写；必须严格按当前市场时段输出判断。',
  ].join('')
}

export function buildSessionPromptRules(session: MarketSessionContext): MarketSessionPromptRules {
  if (session.phase === 'trading') {
    return {
      actionHorizon: '当前到尾盘',
      firstSentenceRequirement: 'summary、entryAdvice、positionAdvice、futureOutlook 的第一句必须围绕当前到尾盘，不得先写下一交易日。',
      forbiddenPhrases: ['若明日开盘', '明日开盘后', '下一交易日开盘后', '下一次开盘后'],
      mustFocus: ['当前到尾盘的执行策略', '盘中承接/分时强弱/尾盘预案'],
      phase: '盘中',
      primaryWindow: '当前到尾盘',
    }
  }

  if (session.phase === 'midday_break') {
    return {
      actionHorizon: '午后开盘后到收盘',
      firstSentenceRequirement: 'summary、entryAdvice、positionAdvice、futureOutlook 的第一句必须先写午后开盘后的策略，不得直接跳到下一交易日。',
      forbiddenPhrases: ['若明日开盘', '明日开盘后', '下一交易日开盘后', '下一次开盘后'],
      mustFocus: ['午后开盘后的执行策略', '上午量价复盘与午后预案'],
      phase: '午间休市',
      primaryWindow: '午后开盘后到收盘',
    }
  }

  if (session.phase === 'pre_market') {
    return {
      actionHorizon: '今日开盘后',
      firstSentenceRequirement: 'summary、entryAdvice、positionAdvice、futureOutlook 的第一句必须围绕今日开盘后，不得先写下一交易日。',
      forbiddenPhrases: ['下一交易日开盘后', '下一次开盘后'],
      mustFocus: ['今日开盘后的执行策略', '开盘 15-30 分钟确认条件'],
      phase: '盘前',
      primaryWindow: '今日开盘后',
    }
  }

  return {
    actionHorizon: session.phase === 'holiday_closed' ? '下一次开盘日' : '下一交易日',
    firstSentenceRequirement: 'summary、entryAdvice、positionAdvice、futureOutlook 的第一句必须围绕下一交易日或下一次开盘，不得写成当前盘中动作。',
    forbiddenPhrases: ['盘中优先看', '午后开盘后', '尾盘直接', '当前交易时段'],
    mustFocus: ['下一交易日或下一次开盘日策略', '竞价/开盘预案'],
    phase: session.phase === 'holiday_closed' ? '休市' : '盘后',
    primaryWindow: session.phase === 'holiday_closed' ? '下一次开盘日' : '下一交易日',
  }
}

export function buildDiagnosisTimingPrompt(session: MarketSessionContext, stockName: string) {
  const rules = buildSessionPromptRules(session)
  const closureLine = session.closureReason
    ? `当前${session.marketLabel}${session.closureLabel}，下一次开盘时间：${session.nextOpenAt}。`
    : `当前${session.marketLabel}本地时间 ${session.currentDate} ${session.currentTime}（${session.timezone}），处于${session.phaseLabel}。`

  return [
    `${closureLine}`,
    `${session.analysisFocus}`,
    `你的分析对象是 ${stockName}，结论必须与当前${session.marketLabel}交易时段匹配：盘前要写今日开盘与日内策略，盘中要写剩余时段与尾盘策略，盘后/休市要写下一交易日或下一次开盘日策略。`,
    `本轮输出优先覆盖：${rules.mustFocus.join('、')}。`,
    `时段约束：${rules.firstSentenceRequirement}`,
    `禁止出现与当前时段冲突的措辞：${rules.forbiddenPhrases.join('、')}。`,
    '如果当前处于休市，不要把结论写成“盘中承接”这类措辞，而要改成“下一次开盘后若出现什么条件就执行什么动作”。',
  ].join('')
}
