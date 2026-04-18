import { computed, defineComponent, nextTick, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, watch } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import type { DiagnosisAgentProgressEvent, DiagnosisAgentResult } from '@/agents/diagnosisAgent'
import { runDiagnosisAgent } from '@/agents/diagnosisAgent'
import { runInvestmentAgent } from '@/agents/investmentAgent'
import { runRecommendationAgent } from '@/agents/recommendationAgent'
import type {
  AskMode,
  DiagnosisAgentStep,
  InvestmentPreferences,
  InvestmentResult,
  RecommendationClarifyQuestion,
  RecommendationPreferences,
  RecommendationResult,
  Strategy,
} from '@/types'
import { useMarketStore } from '@/stores/market'
import { useSettingsStore } from '@/stores/settings'
import { useStrategyStore } from '@/stores/strategy'
import { useAiTaskLogger } from '@/composables/useAiTaskLogger'
import { formatPrice } from '@/utils/format'
import { buildDiagnosisReply } from '@/utils/aiQuestion'
import { buildInvestmentBasisSummary, buildEmptyInvestmentPreferences, parseInvestmentPreferences } from '@/utils/investment'
import { normalizeSecurityCode } from '@/utils/security'
import {
  buildEmptyRecommendationPreferences,
  buildRecommendationClarifyQuestion,
  buildRecommendationBasisSummary,
  getRecommendationMarketLabel,
  marketQuickPrompts,
  parseRecommendationPreferences,
  recommendationNeedsClarification,
} from '@/utils/recommendation'
import {
  listConversations,
  createConversation,
  listMessages,
  addMessage,
  type ChatConversation,
} from '@/utils/chatPersistence'
import { ChevronDown, Plus } from 'lucide-vue-next'

const ACTIVE_CONV_KEY = 'active_conversation_id'

async function getAppStoreValue<T>(key: string): Promise<T | null> {
  try {
    return await invoke<T | null>('app_store_get', { key })
  } catch {
    return null
  }
}

async function setAppStoreValue(key: string, value: unknown) {
  try {
    await invoke('app_store_set', { key, value })
  } catch {}
}

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  startedAt?: number
  completedAt?: number
  code?: string
  stockName?: string
  strategyName?: string
  diagnosis?: DiagnosisAgentResult
  recommendationResult?: RecommendationResult
  investmentResult?: InvestmentResult
  clarifyQuestion?: RecommendationClarifyQuestion
  quickReplies?: string[]
  streamSteps?: DiagnosisAgentStep[]
  streaming?: boolean
  streamingText?: string
  synthesisRunning?: boolean
  loading?: boolean
  askFollowUp?: boolean
}

interface ConversationContextState {
  lastResolvedCode: string
  lastResolvedName: string
  lastQuestion: string
  lastMode: AskMode
}

function isAskMode(value: unknown): value is AskMode {
  return value === 'diagnosis' || value === 'recommendation' || value === 'investment'
}

function createId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
}

function createAssistantMessage(content: string, quickReplies: string[] = []): ChatMessage {
  return {
    id: createId('assistant'),
    role: 'assistant',
    content,
    quickReplies,
  }
}

function createInitialRecommendationState(): RecommendationPreferences {
  return buildEmptyRecommendationPreferences()
}

function createInitialInvestmentState(): InvestmentPreferences {
  return buildEmptyInvestmentPreferences()
}

function extractDirectTicker(question: string) {
  const prefixed = question.match(/\b(?:sh|sz|bj|hk|us)\d{5,6}\b/i)?.[0]
  if (prefixed) return normalizeSecurityCode(prefixed)

  const digits = question.match(/\b\d{5,6}\b/)?.[0]
  if (digits) return normalizeSecurityCode(digits)

  const alpha = question.trim().match(/^(?:us)?[A-Za-z]{1,5}$/)?.[0]
  if (alpha) return normalizeSecurityCode(alpha)

  return ''
}

function createConversationContext(): ConversationContextState {
  return {
    lastResolvedCode: '',
    lastResolvedName: '',
    lastQuestion: '',
    lastMode: 'recommendation',
  }
}

function createAskViewState() {
  return {
    input: ref(''),
    sending: ref(false),
    activeMode: ref<AskMode>('diagnosis'),
    selectedStrategyId: ref('ai_comprehensive'),
    strategyMenuOpen: ref(false),
    openThinkingIds: ref(new Set<string>()),
    openToolIds: ref(new Set<string>()),
    openToolStepIds: ref(new Set<string>()),
    shouldStickToBottom: ref(true),
    recommendationState: ref<RecommendationPreferences>(createInitialRecommendationState()),
    investmentState: ref<InvestmentPreferences>(createInitialInvestmentState()),
    conversationContext: ref<ConversationContextState>(createConversationContext()),
    messages: ref<ChatMessage[]>([
      createAssistantMessage(
        '你好，我是 AI 助手。你直接说想看的市场、股票或交易诉求，我会按当前模式继续分析。',
      ),
    ]),
    conversations: ref<ChatConversation[]>([]),
    activeConversationId: ref<string | null>(null),
  }
}

const askViewState = createAskViewState()
const liveNow = ref(Date.now())
let liveNowTimer: ReturnType<typeof setInterval> | null = null
let liveNowConsumers = 0

function startLiveNowTicker() {
  liveNowConsumers += 1
  if (liveNowTimer) return
  liveNow.value = Date.now()
  liveNowTimer = setInterval(() => {
    liveNow.value = Date.now()
  }, 200)
}

function stopLiveNowTicker() {
  liveNowConsumers = Math.max(0, liveNowConsumers - 1)
  if (liveNowConsumers > 0 || !liveNowTimer) return
  clearInterval(liveNowTimer)
  liveNowTimer = null
}

export default defineComponent({
  name: 'AskView',
  components: { ChevronDown, Plus },
  setup() {
    const marketStore = useMarketStore()
    const settingsStore = useSettingsStore()
    const strategyStore = useStrategyStore()
    const aiTaskLogger = useAiTaskLogger()
    const {
      input,
      sending,
      activeMode,
      selectedStrategyId,
      strategyMenuOpen,
      openThinkingIds,
      openToolIds,
      openToolStepIds,
      shouldStickToBottom,
      recommendationState,
      investmentState,
      conversationContext,
      messages,
      conversations,
      activeConversationId,
    } = askViewState
    const chatListRef = ref<HTMLElement | null>(null)
    const strategyPickerRef = ref<HTMLElement | null>(null)
    const currentTaskId = ref<string | null>(null)
    const currentAssistantMessageId = ref<string | null>(null)
    const starterPrompts = marketQuickPrompts()
    let pageEventsBound = false
    let liveTickerAttached = false

    function toggleThinking(id: string) {
      const next = new Set(openThinkingIds.value)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      openThinkingIds.value = next
    }
    function toggleTools(id: string) {
      const next = new Set(openToolIds.value)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      openToolIds.value = next
    }
    function buildToolStepToggleId(messageId: string, stepId: string) {
      return `${messageId}:${stepId}`
    }
    function toggleToolStep(messageId: string, stepId: string) {
      const key = buildToolStepToggleId(messageId, stepId)
      const next = new Set(openToolStepIds.value)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      openToolStepIds.value = next
    }

    const strategyOptions = computed(() =>
      [...strategyStore.strategies].sort(
        (a, b) => Number(b.enabled) - Number(a.enabled) || Number(b.builtin) - Number(a.builtin) || a.name.localeCompare(b.name),
      ),
    )
    const selectedStrategy = computed<Strategy | null>(() =>
      strategyOptions.value.find((item) => item.id === selectedStrategyId.value) ?? null,
    )
    const isConversationModeLocked = computed(() =>
      messages.value.some((message) => message.role === 'user'),
    )
    const showStrategyPicker = computed(() => activeMode.value !== 'investment')
    const inputPlaceholder = computed(() =>
      activeMode.value === 'recommendation'
        ? '例如：A股短线、偏激进、想看机器人和算力；或港股科技、1-2周机会。'
        : activeMode.value === 'investment'
          ? '例如：我有5万，定投3个月，银行限定中国银行，给我一个理财建议。'
          : '例如：300750 现在怎么看？或 腾讯控股短线是涨还是跌？',
    )
    async function scrollToBottom(force = false) {
      await nextTick()
      if (!chatListRef.value) return
      if (!force && !shouldStickToBottom.value) return
      chatListRef.value.scrollTop = chatListRef.value.scrollHeight
    }

    function handleChatScroll() {
      if (!chatListRef.value) return
      const { scrollTop, clientHeight, scrollHeight } = chatListRef.value
      shouldStickToBottom.value = scrollHeight - (scrollTop + clientHeight) <= 32
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
      if (pageEventsBound) return
      document.addEventListener('mousedown', handleDocumentClick)
      pageEventsBound = true
    }

    function unbindPageEvents() {
      if (!pageEventsBound) return
      document.removeEventListener('mousedown', handleDocumentClick)
      pageEventsBound = false
    }

    function attachLiveNowTicker() {
      if (liveTickerAttached) return
      startLiveNowTicker()
      liveTickerAttached = true
    }

    function detachLiveNowTicker() {
      if (!liveTickerAttached) return
      stopLiveNowTicker()
      liveTickerAttached = false
    }

    function patchMessage(id: string, updater: (message: ChatMessage) => ChatMessage) {
      messages.value = messages.value.map((message) => (message.id === id ? updater(message) : message))
    }

    function isAbortError(error: unknown) {
      return error instanceof Error && error.name === 'AbortError'
    }

    function startAskTask(title: string, assistantMessageId: string) {
      const task = aiTaskLogger.createTask(title, 'ask')
      currentTaskId.value = task.id
      currentAssistantMessageId.value = assistantMessageId
      return task
    }

    function releaseAskTask(taskId: string, assistantMessageId: string) {
      if (currentTaskId.value === taskId) currentTaskId.value = null
      if (currentAssistantMessageId.value === assistantMessageId) currentAssistantMessageId.value = null
    }

    function markAssistantStopped(messageId: string, content = '已停止当前 AI 任务。') {
      patchMessage(messageId, (message) => {
        if ((message.diagnosis || message.recommendationResult || message.investmentResult)
          && !message.streaming
          && !message.loading
          && !message.synthesisRunning) {
          return message
        }
        return {
          ...message,
          content,
          streaming: false,
          streamingText: undefined,
          loading: false,
          synthesisRunning: false,
          completedAt: Date.now(),
        }
      })
      const updated = messages.value.find((message) => message.id === messageId)
      if (updated) {
        void persistMessage(updated)
      }
      void scrollToBottom()
    }

    function stopCurrentAskTask() {
      const taskId = currentTaskId.value
      const assistantMessageId = currentAssistantMessageId.value
      if (taskId) {
        aiTaskLogger.cancelTask(taskId)
      }
      sending.value = false
      currentTaskId.value = null
      currentAssistantMessageId.value = null
      if (assistantMessageId) {
        markAssistantStopped(assistantMessageId)
      }
    }

    function buildStreamingText(step: DiagnosisAgentStep) {
      if (step.status === 'running') {
        if (step.kind === 'plan') return '正在规划研究路径，准备锁定价格、消息、资金和风险重点...'
        if (step.kind === 'synthesis') return '正在汇总结论，生成买卖区间、催化和风险影响...'
        return `正在执行：${step.title}`
      }

      if (step.status === 'error') {
        return `${step.title} 过程中出现异常：${step.resultSummary || '工具调用失败。'}`
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
        if (index >= 0) streamSteps[index] = event.step
        else streamSteps.push(event.step)

        const isSynthesis = event.step.kind === 'synthesis'
        return {
          ...message,
          streamSteps,
          content: buildStreamingText(event.step),
          streaming: true,
          loading: false,
          synthesisRunning: isSynthesis && event.step.status === 'running' ? true : message.synthesisRunning,
        }
      })
      void scrollToBottom()
    }

    let streamThrottleTimer = 0
    function handleStreamDelta(messageId: string, text: string) {
      const now = Date.now()
      if (now - streamThrottleTimer < 60) return
      streamThrottleTimer = now
      patchMessage(messageId, (message) => ({
        ...message,
        streamingText: text,
        streaming: true,
        synthesisRunning: true,
      }))
      void scrollToBottom()
    }

    function buildConversationHistory(): Array<{ role: 'user' | 'assistant'; content: string }> {
      return messages.value
        .filter((m) => m.role === 'user' || (m.role === 'assistant' && m.content && !m.loading && !m.streaming))
        .slice(-12)
        .map((m) => ({
          role: m.role,
          content: m.content.slice(0, 800),
        }))
    }

    function resetRecommendationState() {
      recommendationState.value = createInitialRecommendationState()
    }

    function resetInvestmentState() {
      investmentState.value = createInitialInvestmentState()
    }

    function setMode(mode: AskMode) {
      if (isConversationModeLocked.value) return
      activeMode.value = mode
      if (mode === 'investment') {
        strategyMenuOpen.value = false
      }
    }

    function buildRecommendationReply(result: RecommendationResult) {
      const lead = result.candidates[0]
      const listText = result.candidates.slice(0, 4).map((item) => `${item.name}（${item.code}）`).join('、')
      return [
        `已按 ${buildRecommendationBasisSummary(result.preferences).join(' / ')} 完成筛选。`,
        result.marketSummary,
        listText ? `本轮共给出 ${result.candidates.length} 只重点候选：${listText}。` : '',
        lead
          ? `当前排在前面的候选是 ${lead.name}（${lead.code}），预计启动窗口 ${lead.launchWindow.label}。`
          : '本轮没有筛到足够明确的候选。',
        result.disclaimer,
      ].filter(Boolean).join('\n')
    }

    function mergeRecommendationPreferences(question: string, extracted?: RecommendationPreferences | null) {
      const parsed = parseRecommendationPreferences(question, recommendationState.value)
      if (!extracted) {
        recommendationState.value = parsed
        return parsed
      }
      recommendationState.value = {
        ...parsed,
        ...extracted,
        themes: extracted.themes?.length ? extracted.themes : parsed.themes,
        avoidThemes: extracted.avoidThemes?.length ? extracted.avoidThemes : parsed.avoidThemes,
        mustInclude: extracted.mustInclude?.length ? extracted.mustInclude : parsed.mustInclude,
        mustExclude: extracted.mustExclude?.length ? extracted.mustExclude : parsed.mustExclude,
        originalPrompt: parsed.originalPrompt,
        lastUserMessage: question,
      }
      return recommendationState.value
    }

    function mergeInvestmentPreferences(question: string, extracted?: InvestmentPreferences | null) {
      const parsed = parseInvestmentPreferences(question, investmentState.value)
      if (!extracted) {
        investmentState.value = parsed
        return parsed
      }
      investmentState.value = {
        ...parsed,
        ...extracted,
        bank: extracted.bank || parsed.bank || '中国银行',
        allowedProducts: extracted.allowedProducts?.length ? extracted.allowedProducts : parsed.allowedProducts,
        forbiddenProducts: extracted.forbiddenProducts?.length ? extracted.forbiddenProducts : parsed.forbiddenProducts,
        originalPrompt: parsed.originalPrompt,
        lastUserMessage: question,
      }
      return investmentState.value
    }

    function buildInvestmentReply(result: InvestmentResult) {
      const lead = result.candidates[0]
      return [
        `已按 ${buildInvestmentBasisSummary(result.preferences).join(' / ')} 完成理财测算。`,
        result.marketSummary,
        lead
          ? `当前排在前面的方案是 ${lead.productName}，参考收益区间约 ${formatPrice(lead.estimatedProfitMin)} - ${formatPrice(lead.estimatedProfitMax)}。`
          : '当前可用数据不足以形成明确排序，请调整银行、期限或产品限制后再试。',
        result.disclaimer,
      ].join('\n')
    }

    async function askRecommendationClarify(question: string, assistantMessageId: string, parsedPreferences?: RecommendationPreferences) {
      const preferences = parsedPreferences || mergeRecommendationPreferences(question)
      const clarifyQuestion = buildRecommendationClarifyQuestion(preferences)
      if (!clarifyQuestion) return false

      patchMessage(assistantMessageId, (message) => ({
        ...message,
        content: `${clarifyQuestion.title}\n${clarifyQuestion.prompt}`,
        clarifyQuestion,
        quickReplies: clarifyQuestion.options,
        streaming: false,
        loading: false,
        completedAt: Date.now(),
      }))
      return true
    }

    async function runRecommendation(question: string, assistantMessageId: string, parsedPreferences?: RecommendationPreferences) {
      const preferences = mergeRecommendationPreferences(question, parsedPreferences)
      if (recommendationNeedsClarification(preferences)) {
        const asked = await askRecommendationClarify(question, assistantMessageId, preferences)
        if (asked) return
      }

      const task = startAskTask(`AI荐股 ${question.slice(0, 18)}`, assistantMessageId)
      aiTaskLogger.addLog(task.id, '开始筛选候选池...')
      try {
        patchMessage(assistantMessageId, (message) => ({
          ...message,
          content: `已确认 ${buildRecommendationBasisSummary(preferences).join(' / ')}，开始筛选研究候选池...`,
          clarifyQuestion: undefined,
          quickReplies: [],
          loading: true,
        }))
        await scrollToBottom()

        const result = await runRecommendationAgent({
          preferences,
          provider: settingsStore.activeProvider,
          searchProviders: settingsStore.enabledSearchProviders,
          activeSearchProvider: settingsStore.activeSearchProvider,
          selectedStrategy: selectedStrategy.value,
          maxSteps: settingsStore.settings.ai.diagnosis.maxSteps,
          abortSignal: task.abortController?.signal,
          onProgress: (step) => {
            handleProgress(assistantMessageId, { step })
            aiTaskLogger.addProgressLog(task.id, step)
          },
        })

        if (aiTaskLogger.isTaskCancelled(task.id)) {
          markAssistantStopped(assistantMessageId)
          return
        }

        conversationContext.value = {
          lastResolvedCode: result.candidates[0]?.code || '',
          lastResolvedName: result.candidates[0]?.name || '',
          lastQuestion: question,
          lastMode: 'recommendation',
        }
        patchMessage(assistantMessageId, (message) => ({
          ...message,
          content: buildRecommendationReply(result),
          recommendationResult: result,
          streamSteps: [],
          streaming: false,
          streamingText: undefined,
          loading: false,
          synthesisRunning: false,
          askFollowUp: true,
          quickReplies: ['更稳健一点', '换成港股', '换成美股', '看短线机会'],
          completedAt: Date.now(),
        }))
        aiTaskLogger.addLog(task.id, result.candidates[0]
          ? `荐股完成，首选 ${result.candidates[0].name}（${result.candidates[0].code}）`
          : '荐股完成，本轮暂无明确候选', 'success')
        aiTaskLogger.completeTask(task.id, true)
        void persistMessage({
          id: assistantMessageId,
          role: 'assistant',
          content: buildRecommendationReply(result),
          recommendationResult: result,
          streamSteps: [],
          quickReplies: ['更稳健一点', '换成港股', '换成美股', '看短线机会'],
          askFollowUp: true,
        })
      } catch (error) {
        if (isAbortError(error) || aiTaskLogger.isTaskCancelled(task.id)) {
          markAssistantStopped(assistantMessageId)
          return
        }
        const message = error instanceof Error ? error.message : 'AI 荐股过程中出现错误，请稍后重试。'
        aiTaskLogger.addLog(task.id, `任务失败：${message}`, 'error')
        aiTaskLogger.completeTask(task.id, false, message)
        throw error
      } finally {
        releaseAskTask(task.id, assistantMessageId)
      }
    }

    async function runInvestment(question: string, assistantMessageId: string, parsedPreferences?: InvestmentPreferences) {
      const preferences = mergeInvestmentPreferences(question, parsedPreferences)
      const task = startAskTask(`AI投资 ${question.slice(0, 18)}`, assistantMessageId)
      aiTaskLogger.addLog(task.id, '开始查询银行官方产品、存款利率和基金历史数据...')
      try {
        patchMessage(assistantMessageId, (message) => ({
          ...message,
          content: `已确认 ${buildInvestmentBasisSummary(preferences).join(' / ')}，开始检索官方产品与收益参考...`,
          quickReplies: [],
          loading: true,
        }))
        await scrollToBottom()

        const result = await runInvestmentAgent({
          question,
          preferences,
          provider: settingsStore.activeProvider,
          maxSteps: settingsStore.settings.ai.diagnosis.maxSteps,
          abortSignal: task.abortController?.signal,
          onProgress: (step) => {
            handleProgress(assistantMessageId, { step })
            aiTaskLogger.addProgressLog(task.id, step)
          },
        })

        if (aiTaskLogger.isTaskCancelled(task.id)) {
          markAssistantStopped(assistantMessageId)
          return
        }

        conversationContext.value = {
          lastResolvedCode: '',
          lastResolvedName: preferences.bank || '',
          lastQuestion: question,
          lastMode: 'investment',
        }
        patchMessage(assistantMessageId, (message) => ({
          ...message,
          content: buildInvestmentReply(result),
          investmentResult: result,
          streamSteps: result.trace,
          streaming: false,
          streamingText: undefined,
          loading: false,
          synthesisRunning: false,
          askFollowUp: true,
          quickReplies: ['改成一次性投入', '只看稳健方案', '只看基金方案', '重新按3个月测算'],
          completedAt: Date.now(),
        }))
        aiTaskLogger.addLog(task.id, result.candidates[0]
          ? `投资方案完成，首选 ${result.candidates[0].productName}`
          : '投资方案完成，但候选不足', 'success')
        aiTaskLogger.completeTask(task.id, true)
        void persistMessage({
          id: assistantMessageId,
          role: 'assistant',
          content: buildInvestmentReply(result),
          investmentResult: result,
          streamSteps: result.trace,
          quickReplies: ['改成一次性投入', '只看稳健方案', '只看基金方案', '重新按3个月测算'],
          askFollowUp: true,
        })
      } catch (error) {
        if (isAbortError(error) || aiTaskLogger.isTaskCancelled(task.id)) {
          markAssistantStopped(assistantMessageId)
          return
        }
        const message = error instanceof Error ? error.message : 'AI 投资过程中出现错误，请稍后重试。'
        aiTaskLogger.addLog(task.id, `任务失败：${message}`, 'error')
        aiTaskLogger.completeTask(task.id, false, message)
        throw error
      } finally {
        releaseAskTask(task.id, assistantMessageId)
      }
    }

    async function handleFollowUp(question: string, assistantMessageId: string) {
      const ctx = conversationContext.value
      if (!ctx.lastResolvedCode) {
        patchMessage(assistantMessageId, (message) => ({
          ...message,
          content: '请先告诉我你想研究哪只股票，或者直接描述你想找的交易机会。',
          streaming: false,
          streamingText: undefined,
          loading: false,
          completedAt: Date.now(),
        }))
        return
      }

      patchMessage(assistantMessageId, (message) => ({
        ...message,
        strategyName: selectedStrategy.value?.name || '默认综合框架',
        content: `正在围绕 ${ctx.lastResolvedName}（${ctx.lastResolvedCode}）继续追问分析...`,
        loading: true,
        streaming: true,
      }))
      await scrollToBottom()

      const task = startAskTask(`AI问股追问 ${ctx.lastResolvedName || ctx.lastResolvedCode || question.slice(0, 18)}`, assistantMessageId)
      aiTaskLogger.addLog(task.id, `开始追问分析 ${ctx.lastResolvedName || ctx.lastResolvedCode}...`)
      try {
        const result = await runDiagnosisAgent({
          code: ctx.lastResolvedCode,
          question: `关于 ${ctx.lastResolvedName}（${ctx.lastResolvedCode}）的追问：${question}`,
          provider: settingsStore.activeProvider,
          searchProviders: settingsStore.enabledSearchProviders,
          activeSearchProvider: settingsStore.activeSearchProvider,
          maxSteps: settingsStore.settings.ai.diagnosis.maxSteps,
          period: 'daily',
          adjust: 'qfq',
          selectedStrategy: selectedStrategy.value,
          conversationHistory: buildConversationHistory(),
          resolvedName: ctx.lastResolvedName,
          abortSignal: task.abortController?.signal,
          onProgress: (event) => {
            handleProgress(assistantMessageId, event)
            aiTaskLogger.addProgressLog(task.id, event.step)
          },
          onStreamDelta: (text) => handleStreamDelta(assistantMessageId, text),
        })

        if (aiTaskLogger.isTaskCancelled(task.id)) {
          markAssistantStopped(assistantMessageId)
          return
        }

        conversationContext.value = {
          lastResolvedCode: result.stockInfo.code,
          lastResolvedName: result.stockInfo.name,
          lastQuestion: question,
          lastMode: 'diagnosis',
        }

        patchMessage(assistantMessageId, (message) => ({
          ...message,
          content: buildDiagnosisReply(result),
          code: result.stockInfo.code,
          stockName: result.stockInfo.name,
          diagnosis: result,
          streamSteps: result.trace,
          streaming: false,
          streamingText: undefined,
          loading: false,
          synthesisRunning: false,
          askFollowUp: true,
          quickReplies: ['风险主要在哪里？', '为什么是这个买入区间？', '多久可能启动？'],
          completedAt: Date.now(),
        }))
        aiTaskLogger.addLog(task.id, `追问分析完成，建议：${result.diagnosis.recommendation}`, 'success')
        aiTaskLogger.completeTask(task.id, true)
        void persistMessage({
          id: assistantMessageId,
          role: 'assistant',
          content: buildDiagnosisReply(result),
          code: result.stockInfo.code,
          stockName: result.stockInfo.name,
          diagnosis: result,
          streamSteps: result.trace,
          quickReplies: ['风险主要在哪里？', '为什么是这个买入区间？', '多久可能启动？'],
          askFollowUp: true,
          strategyName: result.selectedStrategy?.name,
        })
      } catch (error) {
        if (isAbortError(error) || aiTaskLogger.isTaskCancelled(task.id)) {
          markAssistantStopped(assistantMessageId)
          return
        }
        const message = error instanceof Error ? error.message : 'AI 追问分析过程中出现错误，请稍后重试。'
        aiTaskLogger.addLog(task.id, `任务失败：${message}`, 'error')
        aiTaskLogger.completeTask(task.id, false, message)
        throw error
      } finally {
        releaseAskTask(task.id, assistantMessageId)
      }
    }

    async function sendMessage(override?: string | Event) {
      const question = (typeof override === 'string' ? override : input.value).trim()
      if (!question || sending.value) return
      if (!settingsStore.isAiProviderConfigured(settingsStore.activeProvider)) {
        messages.value.push(
          { id: createId('user'), role: 'user', content: question },
          createAssistantMessage('当前未配置 AI 模型，无法进行智能分析。请先前往「设置 → 大模型」配置 API 地址、API Key 和模型名称后再使用。'),
        )
        if (typeof override !== 'string') input.value = ''
        await scrollToBottom()
        return
      }
      let assistantMessageId = ''
      let taskId: string | null = null

      await ensureConversationCreated(question)

      messages.value.push({
        id: createId('user'),
        role: 'user',
        content: question,
      })
      await persistMessage({ id: createId('user'), role: 'user', content: question })
      if (typeof override !== 'string') input.value = ''
      sending.value = true
      await scrollToBottom()

      try {
        assistantMessageId = createId('assistant')
        messages.value.push({
          id: assistantMessageId,
          role: 'assistant',
          content: '',
          startedAt: Date.now(),
          streamSteps: [],
          streaming: false,
          loading: true,
        })
        await scrollToBottom()

        if (activeMode.value === 'recommendation') {
          const preferences = mergeRecommendationPreferences(question)
          await runRecommendation(question, assistantMessageId, preferences)
          return
        }

        if (activeMode.value === 'investment') {
          const preferences = mergeInvestmentPreferences(question)
          await runInvestment(question, assistantMessageId, preferences)
          return
        }

        const directCode = extractDirectTicker(question)

        if (!directCode && conversationContext.value.lastMode === 'diagnosis' && conversationContext.value.lastResolvedCode) {
          await handleFollowUp(question, assistantMessageId)
          conversationContext.value.lastQuestion = question
          return
        }

        patchMessage(assistantMessageId, (message) => ({
          ...message,
          strategyName: selectedStrategy.value?.name || '默认综合框架',
          content: '正在识别股票并开始分析...',
          loading: true,
          streaming: true,
        }))
        await scrollToBottom()

        const task = startAskTask(`AI问股 ${question.slice(0, 18)}`, assistantMessageId)
        taskId = task.id
        aiTaskLogger.addLog(task.id, '开始识别股票并整理研究路径...')

        const result = await runDiagnosisAgent({
          code: directCode || undefined,
          question,
          provider: settingsStore.activeProvider,
          searchProviders: settingsStore.enabledSearchProviders,
          activeSearchProvider: settingsStore.activeSearchProvider,
          maxSteps: settingsStore.settings.ai.diagnosis.maxSteps,
          period: 'daily',
          adjust: 'qfq',
          selectedStrategy: selectedStrategy.value,
          conversationHistory: buildConversationHistory(),
          abortSignal: task.abortController?.signal,
          onProgress: (event) => {
            handleProgress(assistantMessageId, event)
            aiTaskLogger.addProgressLog(task.id, event.step)
          },
          onStreamDelta: (text) => handleStreamDelta(assistantMessageId, text),
        })

        if (aiTaskLogger.isTaskCancelled(task.id)) {
          markAssistantStopped(assistantMessageId)
          return
        }

        conversationContext.value = {
          lastResolvedCode: result.stockInfo.code,
          lastResolvedName: result.stockInfo.name,
          lastQuestion: question,
          lastMode: 'diagnosis',
        }

        patchMessage(assistantMessageId, (message) => ({
          ...message,
          code: result.stockInfo.code,
          stockName: result.stockInfo.name,
          diagnosis: result,
          content: buildDiagnosisReply(result),
          streamSteps: result.trace,
          streaming: false,
          streamingText: undefined,
          loading: false,
          synthesisRunning: false,
          askFollowUp: true,
          quickReplies: ['风险主要在哪里？', '为什么是这个买入区间？', '多久可能启动？'],
          completedAt: Date.now(),
        }))
        aiTaskLogger.addLog(task.id, `问股完成，建议：${result.diagnosis.recommendation}`, 'success')
        aiTaskLogger.completeTask(task.id, true)
        void persistMessage({
          id: assistantMessageId,
          role: 'assistant',
          content: buildDiagnosisReply(result),
          code: result.stockInfo.code,
          stockName: result.stockInfo.name,
          diagnosis: result,
          streamSteps: result.trace,
          quickReplies: ['风险主要在哪里？', '为什么是这个买入区间？', '多久可能启动？'],
          askFollowUp: true,
          strategyName: result.selectedStrategy?.name,
        })
        releaseAskTask(task.id, assistantMessageId)
      } catch (error) {
        if (isAbortError(error) || (taskId && aiTaskLogger.isTaskCancelled(taskId))) {
          if (assistantMessageId) {
            markAssistantStopped(assistantMessageId)
          }
          return
        }
        if (taskId) {
          const message = error instanceof Error ? error.message : 'AI 问股过程中出现错误，请稍后重试。'
          aiTaskLogger.addLog(taskId, `任务失败：${message}`, 'error')
          aiTaskLogger.completeTask(taskId, false, message)
        }
        patchMessage(assistantMessageId, (message) => ({
          ...message,
          content: error instanceof Error ? error.message : 'AI 问股过程中出现错误，请稍后重试。',
          streaming: false,
          streamingText: undefined,
          loading: false,
          completedAt: Date.now(),
        }))
      } finally {
        sending.value = false
        if (taskId && assistantMessageId) {
          releaseAskTask(taskId, assistantMessageId)
        }
        await scrollToBottom()
      }
    }

    function sendQuickReply(option: string) {
      input.value = option
      void sendMessage(option)
    }

    function getThinkingSteps(message: ChatMessage) {
      const source = message.diagnosis?.trace ?? message.investmentResult?.trace ?? message.streamSteps ?? []
      return source.filter((item) =>
        item.kind !== 'tool'
        && item.strategy !== 'ReAct Planner'
        && item.title !== '统一智能体规划'
        && Boolean(item.resultSummary || item.inputSummary || item.query),
      )
    }

    function getToolSteps(message: ChatMessage) {
      const source = message.diagnosis?.trace ?? message.investmentResult?.trace ?? message.streamSteps ?? []
      return source.filter((item) => item.kind === 'tool')
    }

    function getThinkingText(message: ChatMessage) {
      const parts = getThinkingSteps(message)
        .map((item) => item.resultSummary || item.query || item.inputSummary || item.title)
        .map((item) => item.trim())
        .filter(Boolean)

      if (!parts.length) {
        if (message.loading || message.streaming) return '智能体已启动，正在分析用户问题并整理研究路径...'
        return '当前没有额外思考内容。'
      }

      return parts.join('\n\n')
    }

    function getResultText(message: ChatMessage) {
      if (message.diagnosis || message.recommendationResult || message.investmentResult) {
        return message.content || '最终结论已生成。'
      }
      if (message.streamingText?.trim()) {
        return message.streamingText
      }
      if (message.synthesisRunning) {
        return '正在根据已采集的证据生成最终结论...'
      }
      if (message.loading || message.streaming) {
        return '等待工具完成后生成最终结论...'
      }
      return message.content || '当前没有可展示的总结内容。'
    }

    function isThinkingExpanded(message: ChatMessage) {
      return openThinkingIds.value.has(message.id)
    }

    function isToolsExpanded(message: ChatMessage) {
      return openToolIds.value.has(message.id)
    }

    function isToolStepExpanded(messageId: string, stepId: string) {
      return openToolStepIds.value.has(buildToolStepToggleId(messageId, stepId))
    }

    function formatDuration(durationMs?: number) {
      if (typeof durationMs !== 'number') return '--'
      if (durationMs < 1000) return `${durationMs}ms`
      return `${(durationMs / 1000).toFixed(1)}s`
    }

    function getStepDurationMs(step: DiagnosisAgentStep) {
      if (step.status === 'running') {
        return Math.max(0, liveNow.value - step.startedAt)
      }
      if (typeof step.durationMs === 'number' && step.durationMs >= 0) {
        return step.durationMs
      }
      return Math.max(0, step.finishedAt - step.startedAt)
    }

    function getStepDurationLabel(step: DiagnosisAgentStep) {
      return formatDuration(getStepDurationMs(step))
    }

    function getMessageElapsedMs(message: ChatMessage) {
      if (!message.startedAt) return undefined
      const endAt = message.completedAt ?? liveNow.value
      return Math.max(0, endAt - message.startedAt)
    }

    function getMessageElapsedLabel(message: ChatMessage) {
      const elapsedMs = getMessageElapsedMs(message)
      if (typeof elapsedMs !== 'number') return ''
      return formatDuration(elapsedMs)
    }

    function isMessageTaskRunning(message: ChatMessage) {
      return Boolean(message.loading || message.streaming || message.synthesisRunning)
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
      if (step.status === 'running') return '正在调用'
      if (step.status === 'done') return '完成'
      if (step.status === 'error') return '异常'
      return '跳过'
    }

    function getToolInputText(step: DiagnosisAgentStep) {
      return step.toolInputText || step.inputSummary || '暂无入参'
    }

    function getToolOutputText(step: DiagnosisAgentStep) {
      if (step.toolOutputText) return step.toolOutputText
      if (step.status === 'running') return '等待工具返回...'
      return step.resultSummary || '暂无出参'
    }

    function getCandidateMarketLabel(code: string) {
      return getRecommendationMarketLabel(code.length === 5 ? 'hk' : /^[A-Z]/.test(code) ? 'us' : 'a')
    }

    watch(
      () => messages.value.length,
      () => {
        void scrollToBottom()
      },
    )

    async function loadConversationList() {
      try {
        conversations.value = await listConversations()
      } catch {}
    }

    async function resetConversationPanel() {
      activeConversationId.value = null
      await setAppStoreValue(ACTIVE_CONV_KEY, null)
      openThinkingIds.value = new Set<string>()
      openToolIds.value = new Set<string>()
      openToolStepIds.value = new Set<string>()
      messages.value = [
        createAssistantMessage(
          '你好，我是 AI 助手。你直接说想看的市场、股票或交易诉求，我会按当前模式继续分析。',
        ),
      ]
      activeMode.value = 'diagnosis'
      strategyMenuOpen.value = false
      resetRecommendationState()
      resetInvestmentState()
      conversationContext.value = createConversationContext()
    }

    async function switchConversation(id: string | null) {
      if (sending.value) return
      if (id === null) {
        await resetConversationPanel()
        return
      }
      if (activeConversationId.value === id) return
      activeConversationId.value = id
      await setAppStoreValue(ACTIVE_CONV_KEY, id)
      openThinkingIds.value = new Set<string>()
      openToolIds.value = new Set<string>()
      openToolStepIds.value = new Set<string>()
      try {
        const records = await listMessages(id)
        let restoredMode: AskMode | null = null
        messages.value = records.map((record) => {
          const base: ChatMessage = {
            id: String(record.id || createId(record.role)),
            role: record.role as 'user' | 'assistant',
            content: record.content,
            code: record.code,
            stockName: record.stockName,
            startedAt: record.createdAt,
            completedAt: record.createdAt,
          }
          if (record.meta) {
            try {
              const meta = JSON.parse(record.meta) as Partial<ChatMessage> & { clarifyQuestion?: RecommendationClarifyQuestion }
              if (meta.diagnosis) base.diagnosis = meta.diagnosis
              if (meta.recommendationResult) base.recommendationResult = meta.recommendationResult
              if (meta.investmentResult) base.investmentResult = meta.investmentResult
              if (meta.streamSteps) base.streamSteps = meta.streamSteps
              if (meta.quickReplies) base.quickReplies = meta.quickReplies
              if (meta.strategyName) base.strategyName = meta.strategyName
              if (meta.askFollowUp) base.askFollowUp = meta.askFollowUp
              if (meta.clarifyQuestion) base.clarifyQuestion = meta.clarifyQuestion
            } catch {}
          }
          if (!restoredMode && isAskMode(record.mode)) {
            restoredMode = record.mode
          }
          return base
        })
        const lastAssistant = [...messages.value].reverse().find((m) => m.role === 'assistant')
        const inferredMode: AskMode = restoredMode
          || (lastAssistant?.investmentResult
            ? 'investment'
            : lastAssistant?.recommendationResult
              ? 'recommendation'
              : 'diagnosis')
        activeMode.value = inferredMode
        strategyMenuOpen.value = false
        recommendationState.value = lastAssistant?.recommendationResult?.preferences || createInitialRecommendationState()
        investmentState.value = lastAssistant?.investmentResult?.preferences || createInitialInvestmentState()
        conversationContext.value = {
          lastResolvedCode: lastAssistant?.code || '',
          lastResolvedName: lastAssistant?.stockName || lastAssistant?.investmentResult?.preferences.bank || '',
          lastQuestion: '',
          lastMode: lastAssistant?.investmentResult ? 'investment' : inferredMode,
        }
      } catch {
        messages.value = [
          createAssistantMessage('加载对话记录失败，请重试。'),
        ]
      }
    }

    async function startNewConversation() {
      await resetConversationPanel()
    }

    async function ensureConversationCreated(firstUserMessage: string) {
      if (activeConversationId.value) return
      const id = createId('conv')
      const title = firstUserMessage.slice(0, 40) + (firstUserMessage.length > 40 ? '...' : '')
      try {
        const conv = await createConversation(id, title)
        activeConversationId.value = conv.id
        conversations.value.unshift(conv)
        await setAppStoreValue(ACTIVE_CONV_KEY, conv.id)
      } catch {}
    }

    async function persistMessage(msg: ChatMessage) {
      if (!activeConversationId.value) return
      const meta: Partial<ChatMessage> & { clarifyQuestion?: RecommendationClarifyQuestion; mode?: AskMode } = {}
      if (msg.diagnosis) meta.diagnosis = msg.diagnosis
      if (msg.recommendationResult) meta.recommendationResult = msg.recommendationResult
      if (msg.investmentResult) meta.investmentResult = msg.investmentResult
      if (msg.streamSteps?.length) meta.streamSteps = msg.streamSteps
      if (msg.quickReplies?.length) meta.quickReplies = msg.quickReplies
      if (msg.strategyName) meta.strategyName = msg.strategyName
      if (msg.askFollowUp) meta.askFollowUp = msg.askFollowUp
      if (msg.clarifyQuestion) meta.clarifyQuestion = msg.clarifyQuestion
      const hasMeta = Object.keys(meta).length > 0
      try {
        await addMessage({
          conversationId: activeConversationId.value,
          role: msg.role,
          content: msg.content,
          code: msg.code,
          stockName: msg.stockName,
          mode: activeMode.value,
          meta: hasMeta ? JSON.stringify(meta) : undefined,
          createdAt: Date.now(),
        })
      } catch {}
    }

    onMounted(async () => {
      attachLiveNowTicker()
      bindPageEvents()
      await loadConversationList()
      if (!marketStore.stockList.length) {
        await marketStore.fetchStockList('a', 1, 80)
      }
      if (!strategyOptions.value.some((item) => item.id === selectedStrategyId.value)) {
        selectedStrategyId.value = strategyOptions.value.find((item) => item.id === 'ai_comprehensive')?.id
          || strategyOptions.value.find((item) => item.enabled)?.id
          || strategyOptions.value[0]?.id
          || ''
      }
      const savedConvId = await getAppStoreValue<string>(ACTIVE_CONV_KEY)
      if (savedConvId && conversations.value.some((c) => c.id === savedConvId)) {
        await switchConversation(savedConvId)
      }
    })

    onActivated(() => {
      attachLiveNowTicker()
      bindPageEvents()
      void loadConversationList()
      void scrollToBottom()
    })

    onDeactivated(() => {
      detachLiveNowTicker()
      unbindPageEvents()
    })

    onBeforeUnmount(() => {
      detachLiveNowTicker()
      unbindPageEvents()
    })

    return {
      input,
      sending,
      chatListRef,
      messages,
      starterPrompts,
      activeMode,
      isConversationModeLocked,
      inputPlaceholder,
      strategyOptions,
      selectedStrategy,
      showStrategyPicker,
      selectedStrategyId,
      strategyMenuOpen,
      strategyPickerRef,
      handleChatScroll,
      sendMessage,
      sendQuickReply,
      setMode,
      selectStrategy,
      getThinkingSteps,
      getToolSteps,
      getThinkingText,
      getResultText,
      isThinkingExpanded,
      isToolsExpanded,
      formatDuration,
      getStepDurationLabel,
      getMessageElapsedLabel,
      isMessageTaskRunning,
      formatRange,
      formatShares,
      getToolStatusLabel,
      getToolInputText,
      getToolOutputText,
      isToolStepExpanded,
      getCandidateMarketLabel,
      openThinkingIds,
      openToolIds,
      openToolStepIds,
      toggleThinking,
      toggleTools,
      toggleToolStep,
      startNewConversation,
      stopCurrentAskTask,
    }
  },
})
