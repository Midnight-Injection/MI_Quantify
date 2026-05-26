import { useSettingsStore } from '@/stores/settings'
import type { AiInsightDigest, AiProvider, DiagnosisAgentStep } from '@/types'
import { runMarketDigestAgent } from '@/agents/marketDigestAgent'

export function useAiInsights() {
  const settingsStore = useSettingsStore()

  async function generateDigest(
    provider: AiProvider | null,
    _payload: unknown,
    options?: {
      title?: string
      market?: string
      currentTime?: string
      watchlistCodes?: string[]
      onProgress?: (step: DiagnosisAgentStep) => void
      abortSignal?: AbortSignal
    },
  ): Promise<AiInsightDigest> {
    return runMarketDigestAgent({
      title: options?.title || 'AI 市场点评',
      market: options?.market || 'a',
      currentTime: options?.currentTime || new Date().toLocaleString('zh-CN', { hour12: false }),
      watchlistCodes: options?.watchlistCodes || [],
      searchProviders: settingsStore.enabledSearchProviders || [],
      provider,
      maxSteps: settingsStore.settings.ai.diagnosis.maxSteps,
      onProgress: options?.onProgress,
      abortSignal: options?.abortSignal,
    })
  }

  return { generateDigest }
}
