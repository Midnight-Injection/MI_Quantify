import type { AiProvider } from './ai'
import type { WatchListStock } from './stock'

export interface ProxyConfig {
  id: string
  name: string
  host: string
  port: number
  protocol: 'http' | 'socks5'
  username: string
  password: string
  enabled: boolean
}

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
  proxyId?: string
}

export interface ProxySettings {
  proxies: ProxyConfig[]
}

export interface AppSettings {
  ai: AiSettings
  appUpdate: AppUpdateSettings
  dataSource: DataSourceSettings
  watchList: WatchListSettings
  notifications: NotificationSettings
  integrations: IntegrationSettings
  appearance: AppearanceSettings
  proxy: ProxySettings
}

export interface AppUpdateSettings {
  autoCheck: boolean
  lastCheckedAt: string
}

export interface AiSettings {
  providers: AiProvider[]
  activeProviderId: string
  diagnosis: DiagnosisAgentSettings
  autoRun: AiAutoRunSettings
  autoRunInterval: number
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
  provider: 'zhipu' | 'searxng' | 'yacy' | 'brave' | 'tavily' | 'serpapi' | 'serper' | 'exa' | 'custom'
  proxyId?: string
}

export interface DiagnosisAgentSettings {
  maxSteps: number
  traceVerbose: boolean
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
  baseUrl: string
  pushUrl?: string
  secret?: string
  autoReplyEnabled?: boolean
  defaultPeerId?: string
}

export interface OpenClawSettings {
  enabled: boolean
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
    autoRunInterval: 45,
    diagnosis: {
      maxSteps: 20,
      traceVerbose: true,
      activeSearchProviderId: '',
      searchProviders: [],
    },
    autoRun: {
      homeDigest: false,
      marketDigest: false,
      analysisDigest: false,
      stockDetailDiagnosis: false,
    },
  },
  appUpdate: {
    autoCheck: true,
    lastCheckedAt: '',
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
  proxy: {
    proxies: [],
  },
}
