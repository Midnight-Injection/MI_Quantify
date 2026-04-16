export type NotificationAlertType =
  | 'price'
  | 'limit_up_touch'
  | 'limit_break'
  | 'limit_up_reseal'
  | 'limit_down'
  | 'limit_down_open'

export interface NotificationAlert {
  id: string
  stockCode: string
  stockName: string
  type: NotificationAlertType
  direction?: 'above' | 'below'
  targetPrice?: number
  enabled: boolean
  triggered: boolean
  cooldownMs?: number
  lastTriggeredAt?: number
  note?: string
  metadata?: Record<string, string | number | boolean>
}

export interface NotificationEntry {
  id?: number
  title: string
  body: string
  time: number
  stockCode?: string
  type?: NotificationAlertType | 'ai' | 'system' | 'strategy' | 'news'
  read?: boolean
}
