import { invoke } from '@tauri-apps/api/core'
import type { NotificationAlert, NotificationEntry, WatchListStock } from '@/types'

interface PersistedAlertPayload {
  id: string
  stockCode: string
  stockName: string
  type: NotificationAlert['type']
  direction?: NotificationAlert['direction']
  targetPrice?: number
  enabled: boolean
  triggered: boolean
  cooldownMs?: number
  lastTriggeredAt?: number
  note?: string
  metadata?: Record<string, string | number | boolean>
}

interface PersistedWatchlistPayload {
  code: string
  name: string
  addedAt: number
  group?: string
  note?: string
}

interface PersistedNotificationPayload {
  id?: number
  title: string
  body: string
  time: number
  stockCode?: string
  type?: NotificationEntry['type']
}

function normalizeAlert(alert: PersistedAlertPayload): NotificationAlert {
  return {
    id: alert.id,
    stockCode: alert.stockCode,
    stockName: alert.stockName,
    type: alert.type,
    direction: alert.direction,
    targetPrice: alert.targetPrice,
    enabled: alert.enabled,
    triggered: alert.triggered,
    cooldownMs: alert.cooldownMs,
    lastTriggeredAt: alert.lastTriggeredAt,
    note: alert.note,
    metadata: alert.metadata,
  }
}

function normalizeWatchlist(entry: PersistedWatchlistPayload): WatchListStock {
  return {
    code: entry.code,
    name: entry.name,
    addedAt: entry.addedAt,
    group: entry.group,
    note: entry.note,
  }
}

function normalizeNotification(entry: PersistedNotificationPayload): NotificationEntry {
  return {
    id: entry.id,
    title: entry.title,
    body: entry.body,
    time: entry.time,
    stockCode: entry.stockCode,
    type: entry.type,
  }
}

export async function getMonitorDbPath() {
  return invoke<string>('monitor_db_path')
}

export async function listPersistedWatchlist() {
  const result = await invoke<PersistedWatchlistPayload[]>('monitor_watchlist_list')
  return result.map(normalizeWatchlist)
}

export async function upsertPersistedWatchlist(entry: WatchListStock) {
  await invoke('monitor_watchlist_upsert', {
    entry: {
      code: entry.code,
      name: entry.name,
      addedAt: entry.addedAt,
      group: entry.group,
      note: entry.note,
    },
  })
}

export async function removePersistedWatchlist(code: string) {
  await invoke('monitor_watchlist_remove', { code })
}

export async function listPersistedAlerts() {
  const result = await invoke<PersistedAlertPayload[]>('monitor_alert_list')
  return result.map(normalizeAlert)
}

export async function upsertPersistedAlert(entry: NotificationAlert) {
  await invoke('monitor_alert_upsert', {
    entry: {
      ...entry,
      stockCode: entry.stockCode,
      stockName: entry.stockName,
    },
  })
}

export async function removePersistedAlert(id: string) {
  await invoke('monitor_alert_remove', { id })
}

export async function togglePersistedAlert(id: string, enabled: boolean) {
  await invoke('monitor_alert_toggle', { id, enabled })
}

export async function touchPersistedAlert(id: string, triggered: boolean, lastTriggeredAt?: number) {
  await invoke('monitor_alert_touch', {
    id,
    triggered,
    lastTriggeredAt: lastTriggeredAt ?? null,
  })
}

export async function listPersistedNotifications(limit = 100) {
  const result = await invoke<PersistedNotificationPayload[]>('monitor_notification_list', { limit })
  return result.map(normalizeNotification)
}

export async function addPersistedNotification(entry: NotificationEntry) {
  await invoke('monitor_notification_add', {
    entry: {
      id: entry.id,
      title: entry.title,
      body: entry.body,
      time: entry.time,
      stockCode: entry.stockCode,
      type: entry.type,
    },
  })
}

export async function clearPersistedNotifications() {
  await invoke('monitor_notification_clear')
}
