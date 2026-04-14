import { computed, defineComponent, nextTick, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, watch } from 'vue'
import type { DiagnosisAgentProgressEvent, DiagnosisAgentResult } from '@/agents/diagnosisAgent'
import { runDiagnosisAgent } from '@/agents/diagnosisAgent'
import type { DiagnosisAgentStep, Strategy } from '@/types'
import { useMarketStore } from '@/stores/market'
import { useSettingsStore } from '@/stores/settings'
import { useStrategyStore } from '@/stores/strategy'
import { formatPrice } from '@/utils/format'
import { buildDiagnosisReply, resolveStockFromQuestion } from '@/utils/aiQuestion'
import { ChevronDown } from 'lucide-vue-next'

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  code?: string
  stockName?: string
  strategyName?: string
  diagnosis?: DiagnosisAgentResult
  streamSteps?: DiagnosisAgentStep[]
  streaming?: boolean
}

function createId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
}

export default defineComponent({
  name: 'AskView',
  components: { ChevronDown },
  setup() {
    const marketStore = useMarketStore()
    const settingsStore = useSettingsStore()
    const strategyStore = useStrategyStore()
    const input = ref('')
    const sending = ref(false)
    const chatListRef = ref<HTMLElement | null>(null)
    const selectedStrategyId = ref('')
    const strategyMenuOpen = ref(false)
    const strategyPickerRef = ref<HTMLElement | null>(null)

    const messages = ref<ChatMessage[]>([
      {
        id: createId('assistant'),
        role: 'assistant',
        content: '直接输入股票代码、名称或问题，例如“贵州茅台现在适合买入吗？”。我会边处理边显示规划、工具和结论。',
      },
    ])

    const strategyOptions = computed(() =>
      [...strategyStore.strategies].sort(
        (a, b) => Number(b.enabled) - Number(a.enabled) || Number(b.builtin) - Number(a.builtin) || a.name.localeCompare(b.name),
      ),
    )
    const selectedStrategy = computed<Strategy | null>(() =>
      strategyOptions.value.find((item) => item.id === selectedStrategyId.value) ?? null,
    )
    const strategyCaption = computed(() =>
      selectedStrategy.value
        ? (selectedStrategy.value.notes || selectedStrategy.value.description)
        : '价格、量能、消息和风险收益比一起评估。',
    )
    const providerLabel = computed(() =>
      settingsStore.activeProvider ? `模型已连接：${settingsStore.activeProvider.name}` : '当前使用本地规则 + 实时数据',
    )

    async function scrollToBottom() {
      await nextTick()
      if (!chatListRef.value) return
      chatListRef.value.scrollTop = chatListRef.value.scrollHeight
    }

    function selectStrategy(id: string) {
      selectedStrategyId.value = id
      strategyMenuOpen.value = false
    }

    function handleDocumentClick(event: MouseEvent) {
      if (!strategyPickerRef.value) return
      if (event.target instanceof Node && strategyPickerRef.value.contains(event.target)) return
      strategyMenuOpen.value = false
    }

    function bindPageEvents() {
      document.addEventListener('mousedown', handleDocumentClick)
    }

    function unbindPageEvents() {
      document.removeEventListener('mousedown', handleDocumentClick)
    }

    function patchMessage(id: string, updater: (message: ChatMessage) => ChatMessage) {
      messages.value = messages.value.map((message) => (message.id === id ? updater(message) : message))
    }

    function buildStreamingText(step: DiagnosisAgentStep) {
      if (step.status === 'running') {
        if (step.kind === 'plan') return '正在规划研究路径，准备锁定价格、消息、资金和风险重点...'
        if (step.kind === 'synthesis') return '正在汇总结论，生成买卖区间、催化和风险影响...'
        return `正在执行：${step.title}`
      }

      if (step.status === 'error') {
        return `${step.title} 过程中出现异常：${step.resultSummary || '已回退到可用数据继续处理。'}`
      }

      if (step.status === 'skipped') {
        return `${step.title} 已跳过：${step.resultSummary || '当前阶段未启用。'}`
      }

      return `${step.title} 已完成：${step.resultSummary || '已采集到最新结果。'}`
    }

    function handleProgress(messageId: string, event: DiagnosisAgentProgressEvent) {
      patchMessage(messageId, (message) => {
        const streamSteps = [...(message.streamSteps || [])]
        const index = streamSteps.findIndex((item) => item.id === event.step.id)
        if (index >= 0) {
          streamSteps[index] = event.step
        } else {
          streamSteps.push(event.step)
        }
        return {
          ...message,
          streamSteps,
          content: buildStreamingText(event.step),
          streaming: true,
        }
      })
      void scrollToBottom()
    }

    async function sendMessage() {
      const question = input.value.trim()
      if (!question || sending.value) return
      let assistantMessageId = ''

      messages.value.push({
        id: createId('user'),
        role: 'user',
        content: question,
      })
      input.value = ''
      sending.value = true
      await scrollToBottom()

      try {
        const resolved = await resolveStockFromQuestion(question, marketStore.searchStock, marketStore.stockList)
        if (!resolved) {
          messages.value.push({
            id: createId('assistant'),
            role: 'assistant',
            content: '还没有识别到明确的股票，请补充 6 位股票代码或更明确的股票名称。',
          })
          return
        }

        assistantMessageId = createId('assistant')
        messages.value.push({
          id: assistantMessageId,
          role: 'assistant',
          code: resolved.code,
          stockName: resolved.name,
          strategyName: selectedStrategy.value?.name || '默认综合框架',
          content: '已锁定股票，正在开始分析...',
          streamSteps: [],
          streaming: true,
        })
        await scrollToBottom()

        const result = await runDiagnosisAgent({
          code: resolved.code,
          provider: settingsStore.activeProvider,
          searchProviders: settingsStore.enabledSearchProviders,
          activeSearchProvider: settingsStore.activeSearchProvider,
          maxSteps: settingsStore.settings.ai.diagnosis.maxSteps,
          period: 'daily',
          adjust: 'qfq',
          selectedStrategy: selectedStrategy.value,
          question,
          resolvedName: resolved.name,
          matchedKeyword: resolved.keyword,
          matchCandidates: resolved.candidates,
          onProgress: (event) => handleProgress(assistantMessageId, event),
        })

        patchMessage(assistantMessageId, (message) => ({
          ...message,
          code: result.stockInfo.code,
          stockName: result.stockInfo.name,
          diagnosis: result,
          content: buildDiagnosisReply(result, resolved),
          streamSteps: result.trace,
          streaming: false,
        }))
      } catch (error) {
        if (assistantMessageId) {
          patchMessage(assistantMessageId, (message) => ({
            ...message,
            content: error instanceof Error ? error.message : '问股过程中出现错误，请稍后重试。',
            streaming: false,
          }))
        } else {
          messages.value.push({
            id: createId('assistant'),
            role: 'assistant',
            content: error instanceof Error ? error.message : '问股过程中出现错误，请稍后重试。',
          })
        }
      } finally {
        sending.value = false
        await scrollToBottom()
      }
    }

    function getThinkingSteps(message: ChatMessage) {
      const source = message.diagnosis?.trace ?? message.streamSteps ?? []
      return source.filter((item) => item.kind !== 'tool')
    }

    function getToolSteps(message: ChatMessage) {
      const source = message.diagnosis?.trace ?? message.streamSteps ?? []
      return source.filter((item) => item.kind === 'tool')
    }

    function getEvidence(message: ChatMessage) {
      return message.diagnosis?.diagnosis.evidence ?? []
    }

    function getScenarios(message: ChatMessage) {
      return message.diagnosis?.diagnosis.scenarios ?? []
    }

    function formatDuration(durationMs?: number) {
      if (typeof durationMs !== 'number') return '--'
      if (durationMs < 1000) return `${durationMs}ms`
      return `${(durationMs / 1000).toFixed(1)}s`
    }

    function formatRange(lower?: number, upper?: number) {
      if (typeof lower === 'number' && typeof upper === 'number') {
        return `${formatPrice(lower)} - ${formatPrice(upper)}`
      }
      return '--'
    }

    function formatShares(value?: number) {
      if (typeof value !== 'number' || Number.isNaN(value) || value <= 0) return '--'
      return `${value} 股`
    }

    function getToolStatusLabel(step: DiagnosisAgentStep) {
      if (step.status === 'running') return '进行中'
      if (step.status === 'done') return '完成'
      if (step.status === 'error') return '异常'
      return '跳过'
    }

    watch(
      () => messages.value.length,
      () => {
        void scrollToBottom()
      },
    )

    onBeforeUnmount(() => {
      unbindPageEvents()
    })

    onMounted(async () => {
      bindPageEvents()
      if (!marketStore.stockList.length) {
        await marketStore.fetchStockList('a', 1, 80)
      }
    })

    onActivated(() => {
      bindPageEvents()
      void scrollToBottom()
    })

    onDeactivated(() => {
      unbindPageEvents()
    })

    return {
      input,
      sending,
      chatListRef,
      messages,
      strategyOptions,
      selectedStrategy,
      selectedStrategyId,
      strategyCaption,
      strategyMenuOpen,
      strategyPickerRef,
      providerLabel,
      sendMessage,
      selectStrategy,
      getThinkingSteps,
      getToolSteps,
      getEvidence,
      getScenarios,
      formatDuration,
      formatRange,
      formatShares,
      getToolStatusLabel,
      settingsStore,
    }
  },
})
