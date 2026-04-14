import type { AiProvider } from './ai'
import type { WatchListStock } from './stock'

export interface DataSource {
  id: string
  name: string
  enabled: boolean
  type: 'free' | 'paid'
  apiKey: string
  apiSecret: string
  apiUrl: string
  priority: number
  mode?: 'sidecar' | 'remote'
  coverage?: string
  description?: string
  requiresKey?: boolean
  requiresSecret?: boolean
}

export interface AppSettings {
  ai: AiSettings
  dataSource: DataSourceSettings
  watchList: WatchListSettings
  notifications: NotificationSettings
  integrations: IntegrationSettings
  appearance: AppearanceSettings
}

export interface AiSettings {
  providers: AiProvider[]
  activeProviderId: string
  diagnosis: DiagnosisAgentSettings
  autoRun: AiAutoRunSettings
}

export interface AiAutoRunSettings {
  homeDigest: boolean
  marketDigest: boolean
  analysisDigest: boolean
  stockDetailDiagnosis: boolean
}

export interface SearchProvider {
  id: string
  name: string
  enabled: boolean
  apiUrl: string
  apiKey: string
  provider: 'zhipu' | 'searxng' | 'yacy' | 'custom'
}

export interface DiagnosisAgentSettings {
  maxSteps: number
  traceVerbose: boolean
  autoImportLocalProvider: boolean
  activeSearchProviderId: string
  searchProviders: SearchProvider[]
}

export interface DataSourceSettings {
  sources: DataSource[]
  refreshInterval: number
  realTimeEnabled: boolean
}

export interface WatchListSettings {
  stocks: WatchListStock[]
}

export interface NotificationSettings {
  priceAlertEnabled: boolean
  strategyAlertEnabled: boolean
  newsAlertEnabled: boolean
  limitUpAlertEnabled: boolean
  boardOpenAlertEnabled: boolean
  boardResealAlertEnabled: boolean
  limitDownAlertEnabled: boolean
  limitDownOpenAlertEnabled: boolean
  desktopEnabled: boolean
}

export interface IntegrationSettings {
  openClaw: OpenClawSettings
}

export type OpenClawChannelType = 'wechat' | 'webhook' | 'qywx'

export interface OpenClawChannelSettings {
  id: string
  name: string
  channelType: OpenClawChannelType
  enabled: boolean
  autoStart: boolean
  baseUrl: string
  pushUrl?: string
  secret?: string
  autoReplyEnabled?: boolean
  pushEnabled?: boolean
  defaultPeerId?: string
}

export interface OpenClawSettings {
  enabled: boolean
  pushEnabled: boolean
  pushUrl: string
  pushToken: string
  inboundSecret: string
  botName: string
  defaultConversationId: string
  channels: OpenClawChannelSettings[]
}

export interface AppearanceSettings {
  theme: 'dark' | 'light'
  fontSize: number
}

export const DEFAULT_SETTINGS: AppSettings = {
  ai: {
    providers: [],
    activeProviderId: '',
    diagnosis: {
      maxSteps: 6,
      traceVerbose: true,
      autoImportLocalProvider: true,
      activeSearchProviderId: '',
      searchProviders: [],
    },
    autoRun: {
      homeDigest: true,
      marketDigest: true,
      analysisDigest: true,
      stockDetailDiagnosis: false,
    },
  },
  dataSource: {
    sources: [],
    refreshInterval: 5,
    realTimeEnabled: true,
  },
  watchList: {
    stocks: [],
  },
  notifications: {
    priceAlertEnabled: true,
    strategyAlertEnabled: true,
    newsAlertEnabled: true,
    limitUpAlertEnabled: true,
    boardOpenAlertEnabled: true,
    boardResealAlertEnabled: true,
    limitDownAlertEnabled: true,
    limitDownOpenAlertEnabled: true,
    desktopEnabled: true,
  },
  integrations: {
    openClaw: {
      enabled: false,
      pushEnabled: false,
      pushUrl: '',
      pushToken: '',
      inboundSecret: '',
      botName: 'MI Quantify',
      defaultConversationId: '',
      channels: [],
    },
  },
  appearance: {
    theme: 'dark',
    fontSize: 14,
  },
}
