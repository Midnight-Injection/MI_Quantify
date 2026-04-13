import { ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { load } from '@tauri-apps/plugin-store'
import type { NotificationAlert, NotificationAlertType, NotificationEntry, StockQuote } from '@/types'
import { getLimitPrices } from '@/utils/marketMetrics'
import { useSettingsStore } from '@/stores/settings'
import {
  addPersistedNotification,
  clearPersistedNotifications,
  listPersistedAlerts,
  listPersistedNotifications,
  removePersistedAlert,
  togglePersistedAlert,
  touchPersistedAlert,
  upsertPersistedAlert,
} from '@/utils/monitorPersistence'

interface ScheduledTask {
  id: string
  name: string
  task_type: string
  cron: string
  enabled: boolean
  last_run: string | null
  next_run: string | null
}

const ALERTS_KEY = 'alerts'
const HISTORY_KEY = 'history'
const STORE_FILE = 'notifications.json'

const alerts = ref<NotificationAlert[]>([])
const tasks = ref<ScheduledTask[]>([])
const notifications = ref<NotificationEntry[]>([])
const initialized = ref(false)

export type BoardAlertType = Exclude<NotificationAlertType, 'price'>

export const BOARD_ALERT_TYPES: BoardAlertType[] = [
  'limit_up_touch',
  'limit_break',
  'limit_up_reseal',
  'limit_down',
  'limit_down_open',
]

export function isBoardAlertType(type: NotificationAlertType): type is BoardAlertType {
  return BOARD_ALERT_TYPES.includes(type as BoardAlertType)
}

let storeInstance: Awaited<ReturnType<typeof load>> | null = null

async function getStore() {
  if (!storeInstance) {
    storeInstance = await load(STORE_FILE)
  }
  return storeInstance
}

async function persist() {
  for (const item of alerts.value) {
    await upsertPersistedAlert(item)
  }
}

async function init() {
  if (initialized.value) return
  alerts.value = await listPersistedAlerts()
  notifications.value = await listPersistedNotifications(100)

  if (!alerts.value.length && !notifications.value.length) {
    const store = await getStore()
    const legacyAlerts = (await store.get<NotificationAlert[]>(ALERTS_KEY)) ?? []
    const legacyHistory = (await store.get<NotificationEntry[]>(HISTORY_KEY)) ?? []
    alerts.value = legacyAlerts
    notifications.value = legacyHistory

    for (const item of legacyAlerts) {
      await upsertPersistedAlert(item)
    }
    for (const item of legacyHistory) {
      await addPersistedNotification(item)
    }
  }
  initialized.value = true
}

function buildAlertId(prefix: string, stockCode: string) {
  return `${prefix}_${stockCode}_${Date.now()}`
}

async function fetchAlerts() {
  await init()
  alerts.value = await listPersistedAlerts()
  return alerts.value
}

async function addAlert(
  stockCode: string,
  stockName: string,
  targetPrice: number,
  direction: string,
  delivery: 'all' | 'desktop' | 'wechat' = 'all',
) {
  await init()
  const alert: NotificationAlert = {
    id: buildAlertId('price', stockCode),
    stockCode,
    stockName,
    type: 'price',
    direction: direction === 'below' ? 'below' : 'above',
    targetPrice,
    enabled: true,
    triggered: false,
    cooldownMs: 10 * 60 * 1000,
    note: direction === 'below' ? `跌破 ${targetPrice}` : `突破 ${targetPrice}`,
    metadata: {
      delivery,
    },
  }
  alerts.value.unshift(alert)
  await upsertPersistedAlert(alert)
}

function boardAlertNote(type: NotificationAlert['type']) {
  switch (type) {
    case 'limit_up_touch':
      return '涨停触发提醒'
    case 'limit_break':
      return '涨停开板提醒'
    case 'limit_up_reseal':
      return '涨停回封提醒'
    case 'limit_down':
      return '跌停触发提醒'
    case 'limit_down_open':
      return '跌停开板提醒'
    default:
      return '阶段提醒'
  }
}

export function getBoardAlertLabel(type: NotificationAlertType) {
  return boardAlertNote(type)
}

async function addBoardAlert(
  stockCode: string,
  stockName: string,
  type: BoardAlertType,
  delivery: 'all' | 'desktop' | 'wechat' = 'all',
) {
  await init()
  const exists = alerts.value.some((item) => item.stockCode === stockCode && item.type === type)
  if (exists) return false
  const alert: NotificationAlert = {
    id: buildAlertId(type, stockCode),
    stockCode,
    stockName,
    type,
    enabled: true,
    triggered: false,
    cooldownMs: 30 * 60 * 1000,
    note: boardAlertNote(type),
    metadata: {
      delivery,
    },
  }
  alerts.value.unshift(alert)
  await upsertPersistedAlert(alert)
  return true
}

async function addBoardAlerts(
  stockCode: string,
  stockName: string,
  types: NotificationAlertType[],
  delivery: 'all' | 'desktop' | 'wechat' = 'all',
) {
  await init()
  let added = 0
  let skipped = 0
  for (const type of types) {
    if (!isBoardAlertType(type)) {
      skipped += 1
      continue
    }
    const created = await addBoardAlert(stockCode, stockName, type, delivery)
    if (created) {
      added += 1
      continue
    }
    skipped += 1
  }
  return { added, skipped }
}

async function removeAlert(id: string) {
  await init()
  alerts.value = alerts.value.filter((item) => item.id !== id)
  await removePersistedAlert(id)
}

async function toggleAlert(id: string, enabled: boolean) {
  await init()
  alerts.value = alerts.value.map((item) => (item.id === id ? { ...item, enabled } : item))
  await togglePersistedAlert(id, enabled)
}

async function fetchTasks() {
  try {
    tasks.value = await invoke<ScheduledTask[]>('scheduler_list')
  } catch {
    tasks.value = []
  }
}

async function toggleTask(id: string, enabled: boolean) {
  try {
    await invoke('scheduler_toggle', { id, enabled })
    await fetchTasks()
  } catch {}
}

async function runTaskNow(id: string) {
  try {
    await invoke('scheduler_run_now', { id })
  } catch {}
}

async function pushNotification(
  title: string,
  body: string,
  entry: Partial<NotificationEntry> & { delivery?: 'all' | 'desktop' | 'wechat' } = {},
) {
  await init()
  const settingsStore = useSettingsStore()
  try {
    if (entry.delivery !== 'wechat' && settingsStore.settings.notifications.desktopEnabled) {
      await invoke('send_notification', { title, body })
    }
  } catch {}
  const notificationEntry: NotificationEntry = {
    title,
    body,
    time: Date.now(),
    stockCode: entry.stockCode,
    type: entry.type,
  }
  notifications.value.unshift(notificationEntry)
  notifications.value = notifications.value.slice(0, 100)
  await pushOpenClawNotification(title, body, entry)
  await addPersistedNotification(notificationEntry)
}

async function pushOpenClawNotification(title: string, body: string, entry: Partial<NotificationEntry> = {}) {
  const settingsStore = useSettingsStore()
  const openClaw = settingsStore.settings.integrations.openClaw
  if (!openClaw.enabled || (entry as { delivery?: string }).delivery === 'desktop') return

  const activeChannels = openClaw.channels.filter(
    (item) => item.channelType === 'wechat' && item.enabled && item.pushEnabled && item.defaultPeerId,
  )
  for (const channel of activeChannels) {
    try {
      await invoke('wechat_send_message', {
        channelId: channel.id,
        toUserId: channel.defaultPeerId,
        text: `${title}\n${body}`,
        contextToken: '',
      })
    } catch (error) {
      console.warn('[channel-push] push failed:', error)
    }
  }
}

function shouldSkipByCooldown(alert: NotificationAlert) {
  if (!alert.lastTriggeredAt) return false
  return Date.now() - alert.lastTriggeredAt < (alert.cooldownMs ?? 0)
}

async function triggerAlert(alert: NotificationAlert, body: string) {
  const now = Date.now()
  await pushNotification(`${alert.stockName} ${alert.note || '提醒'}`, body, {
    stockCode: alert.stockCode,
    type: alert.type,
    delivery: `${alert.metadata?.delivery || 'all'}` as 'all' | 'desktop' | 'wechat',
  })
  alerts.value = alerts.value.map((item) =>
    item.id === alert.id
      ? {
          ...item,
          triggered: true,
          lastTriggeredAt: now,
        }
      : item,
  )
  await touchPersistedAlert(alert.id, true, now)
}

async function scanQuotes(quotes: StockQuote[]) {
  await init()
  if (!quotes.length || !alerts.value.length) return

  const quoteMap = new Map(quotes.map((quote) => [quote.code, quote]))

  for (const alert of alerts.value) {
    if (!alert.enabled || shouldSkipByCooldown(alert)) continue
    const quote = quoteMap.get(alert.stockCode)
    if (!quote) continue

    if (alert.type === 'price' && typeof alert.targetPrice === 'number') {
      const isTriggered =
        alert.direction === 'below' ? quote.price <= alert.targetPrice : quote.price >= alert.targetPrice
      if (isTriggered) {
        await triggerAlert(
          alert,
          `现价 ${quote.price.toFixed(2)}，${alert.direction === 'below' ? '跌破' : '突破'} ${alert.targetPrice.toFixed(2)}。`,
        )
      }
      continue
    }

    const limits = getLimitPrices(quote.code, quote.preClose)
    if (alert.type === 'limit_up_touch') {
      const touchedLimitUp = quote.high >= limits.limitUp * 0.998 || quote.price >= limits.limitUp * 0.998
      if (touchedLimitUp) {
        await triggerAlert(
          alert,
          `盘中触及涨停参考价 ${limits.limitUp.toFixed(2)}，现价 ${quote.price.toFixed(2)}，请结合封单与量能确认持续性。`,
        )
      }
      continue
    }

    if (alert.type === 'limit_break') {
      const touchedLimitUp = quote.high >= limits.limitUp * 0.998
      const openedBoard = touchedLimitUp && quote.price < limits.limitUp * 0.995
      if (openedBoard) {
        await triggerAlert(
          alert,
          `盘中触及涨停 ${limits.limitUp.toFixed(2)} 后回落，现价 ${quote.price.toFixed(2)}，适合检查承接与量能。`,
        )
      }
      continue
    }

    if (alert.type === 'limit_up_reseal') {
      const touchedLimitUp = quote.high >= limits.limitUp * 0.998
      const resealedBoard = touchedLimitUp && quote.price >= limits.limitUp * 0.998
      if (resealedBoard) {
        await triggerAlert(
          alert,
          `盘中回封涨停 ${limits.limitUp.toFixed(2)}，现价 ${quote.price.toFixed(2)}，适合复核封单质量和次日溢价预期。`,
        )
      }
      continue
    }

    if (alert.type === 'limit_down') {
      const nearLimitDown = quote.price <= limits.limitDown * 1.005 || quote.changePercent <= -limits.ratio * 100 * 0.95
      if (nearLimitDown) {
        await triggerAlert(
          alert,
          `已接近跌停价 ${limits.limitDown.toFixed(2)}，现价 ${quote.price.toFixed(2)}，请注意流动性与风险控制。`,
        )
      }
      continue
    }

    if (alert.type === 'limit_down_open') {
      const touchedLimitDown = quote.low <= limits.limitDown * 1.002
      const openedLimitDown = touchedLimitDown && quote.price > limits.limitDown * 1.01
      if (openedLimitDown) {
        await triggerAlert(
          alert,
          `盘中跌停后打开，跌停参考价 ${limits.limitDown.toFixed(2)}，现价 ${quote.price.toFixed(2)}，需重点确认承接质量。`,
        )
      }
    }
  }
}

function getTrackedCodes() {
  return Array.from(new Set(alerts.value.filter((item) => item.enabled).map((item) => item.stockCode)))
}

async function clearNotifications() {
  notifications.value = []
  await clearPersistedNotifications()
}

export function useNotifications() {
  return {
    alerts,
    tasks,
    notifications,
    initialized,
    init,
    fetchAlerts,
    addAlert,
    addBoardAlert,
    addBoardAlerts,
    removeAlert,
    toggleAlert,
    fetchTasks,
    toggleTask,
    runTaskNow,
    pushNotification,
    scanQuotes,
    getTrackedCodes,
    clearNotifications,
  }
}
