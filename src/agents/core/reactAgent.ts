import { useAiChat } from '@/composables/useAiChat'
import type { AiMessage, AiProvider, DiagnosisAgentStep } from '@/types'

type JsonRecord = Record<string, unknown>

interface ReActDecision<TFinal = unknown> {
  thought?: string
  action?: 'tool' | 'finish'
  toolName?: string
  toolInput?: JsonRecord
  finishReason?: string
  finalAnswer?: TFinal
}

export interface ReActToolResult {
  observation?: unknown
  summary?: string
  empty?: boolean
  resultCount?: number
  sourceCount?: number
  retryable?: boolean
}

export interface ReActTool<TContext = void> {
  name: string
  description: string
  inputSchema?: JsonRecord
  execute: (input: JsonRecord, context: TContext) => Promise<ReActToolResult>
}

export interface ReActLoopOptions<TContext = void, TFinal = unknown> {
  provider: AiProvider
  context: TContext
  tools: ReActTool<TContext>[]
  systemPrompt?: string
  userPrompt?: string
  historyMessages?: AiMessage[]
  finalAnswerSchema?: unknown
  nextStepPrompt?: string
  requireFinalAnswer?: boolean
  maxTurns?: number
  toolTemperature?: number
  toolMaxTokens?: number
  toolTimeoutMs?: number
  planInputSummary?: string
  planQuery?: string
  onProgress?: (step: DiagnosisAgentStep) => void
  abortSignal?: AbortSignal
}

export interface ReActLoopResult<TFinal = unknown> {
  messages: AiMessage[]
  trace: DiagnosisAgentStep[]
  finishReason: string
  finalAnswer?: TFinal
}

export function normalizeAgentMaxSteps(
  value: number | undefined,
  options: { min?: number; fallback?: number; max?: number } = {},
) {
  const min = options.min ?? 4
  const fallback = options.fallback ?? 8
  const max = options.max ?? 100
  const raw = Number(value)
  const normalized = Number.isFinite(raw) ? Math.round(raw) : fallback
  return Math.min(max, Math.max(min, normalized))
}

function parseJsonBlock<T>(raw: string): T {
  const fenced = raw.match(/```json\s*([\s\S]*?)\s*```/i)
  const candidate = fenced?.[1] || extractFirstJsonObject(raw)
  if (!candidate) {
    throw new Error('模型未返回合法 JSON')
  }
  return JSON.parse(candidate) as T
}

function extractFirstJsonObject(raw: string) {
  const start = raw.indexOf('{')
  if (start === -1) return ''
  let depth = 0
  let inString = false
  let escaped = false
  for (let index = start; index < raw.length; index += 1) {
    const char = raw[index]
    if (inString) {
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (char === '"') {
        inString = false
      }
      continue
    }
    if (char === '"') {
      inString = true
      continue
    }
    if (char === '{') {
      depth += 1
      continue
    }
    if (char === '}') {
      depth -= 1
      if (depth === 0) {
        return raw.slice(start, index + 1)
      }
    }
  }
  return ''
}

function createStep(partial: Omit<DiagnosisAgentStep, 'id' | 'startedAt' | 'finishedAt'>): DiagnosisAgentStep {
  const now = Date.now()
  return {
    id: `${partial.kind}_${now}_${Math.random().toString(36).slice(2, 8)}`,
    startedAt: now,
    finishedAt: now,
    durationMs: 0,
    ...partial,
  }
}

function stringifyToolCatalog<TContext>(tools: ReActTool<TContext>[]) {
  return JSON.stringify(
    tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema || {},
    })),
    null,
    2,
  )
}

function normalizeToolInput(input: unknown): JsonRecord {
  if (!input || Array.isArray(input) || typeof input !== 'object') {
    return {}
  }
  return input as JsonRecord
}

function clipObservation(value: unknown) {
  const text = JSON.stringify(value, null, 2)
  if (text.length <= 2500) return value
  return {
    truncated: true,
    preview: text.slice(0, 2500),
  }
}

function stringifyToolText(value: unknown, fallback = '') {
  if (typeof value === 'string') {
    return value || fallback
  }
  if (value === undefined) return fallback
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function createAbortError() {
  const error = new Error('AI 任务已停止')
  error.name = 'AbortError'
  return error
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw createAbortError()
  }
}

export async function runReActLoop<TContext, TFinal = unknown>(
  options: ReActLoopOptions<TContext, TFinal>,
): Promise<ReActLoopResult<TFinal>> {
  const { chat } = useAiChat()
  const trace: DiagnosisAgentStep[] = []
  const messages: AiMessage[] = []
  const historyMessages = options.historyMessages || []
  const hasHistory = historyMessages.length > 0
  const toolFailureLimit = 3
  const finalAnswerSchemaText = options.finalAnswerSchema
    ? `\n最终 finish 时必须返回 finalAnswer，结构如下：\n${stringifyToolText(options.finalAnswerSchema, '{}')}`
    : ''
  const protocolPrompt = `你必须严格遵守以下 ReAct 输出协议：
1. 每一轮只能输出一个 JSON 对象。
2. JSON 结构只能是：
{"thought":"本轮思考","action":"tool","toolName":"工具名","toolInput":{...}}
或
{"thought":"本轮思考","action":"finish","finishReason":"已经拿到足够证据","finalAnswer":{...}}
3. 每一轮最多只能调用一个工具。
4. 只能使用给定工具，不能伪造工具结果。
5. 如果当前数据还不能完整回答用户需求，必须继续选择下一个工具，不要提前 finish。
6. 只有确认当前证据已经足够满足用户需求时，才能 finish。
7. 同一个工具如果已经失败 3 次，不要再继续调用它。
8. 所有输出必须是合法 JSON，不要输出解释、Markdown 或代码块外文本。${finalAnswerSchemaText}`
  const nextStepPrompt = options.nextStepPrompt?.trim() || '请判断当前已拿到的数据是否足以完整回答用户需求；如果还不够，继续只选择一个最有必要的工具并给出准确参数；如果已经足够，立即 finish 并返回 finalAnswer。'
  const jsonRepairPrompt = '你上一条回复没有严格遵守 ReAct JSON 协议。请基于同一轮决策，只重发一个合法 JSON 对象，不要输出解释、Markdown、代码块或额外文本。'

  if (!hasHistory && options.systemPrompt?.trim()) {
    messages.push({
      role: 'system',
      content: `${options.systemPrompt}\n\n${protocolPrompt}`,
    })
  }

  if (hasHistory) {
    messages.push(...historyMessages)
  }

  const initialPromptParts = [
    options.userPrompt?.trim() || '',
    `可用工具：\n${stringifyToolCatalog(options.tools)}`,
    hasHistory ? protocolPrompt : '',
    nextStepPrompt,
  ].filter(Boolean)

  if (initialPromptParts.length) {
    messages.push({
      role: 'user',
      content: initialPromptParts.join('\n\n'),
    })
  }

  const planRunning = createStep({
    kind: 'plan',
    title: '统一智能体规划',
    status: 'running',
    strategy: 'ReAct Planner',
    inputSummary: options.planInputSummary,
    resultSummary: '正在进入 ReAct 工具循环...',
    query: options.planQuery,
  })
  options.onProgress?.(planRunning)

  const planDone: DiagnosisAgentStep = {
    ...planRunning,
    status: 'done',
    finishedAt: Date.now(),
    durationMs: Date.now() - planRunning.startedAt,
    resultSummary: `已载入 ${options.tools.length} 个工具，开始按需轮询。`,
  }
  trace.push(planDone)
  options.onProgress?.(planDone)

  let finishReason = '达到最大轮数后结束'
  let finalAnswer: TFinal | undefined
  const toolFailureHistory = new Map<string, number>()

  for (let turn = 0; turn < Math.max(1, options.maxTurns || 8); turn += 1) {
    throwIfAborted(options.abortSignal)
    let decision: ReActDecision<TFinal> | null = null
    let lastRaw = ''
    for (let repairAttempt = 0; repairAttempt < 3; repairAttempt += 1) {
      const raw = await chat(
        options.provider,
        messages,
        {
          temperature: options.toolTemperature ?? 0.1,
          maxTokens: options.toolMaxTokens ?? 900,
          signal: options.abortSignal,
          timeoutMs: options.toolTimeoutMs,
        },
      )
      lastRaw = raw
      try {
        decision = parseJsonBlock<ReActDecision<TFinal>>(raw)
        break
      } catch (error) {
        if (repairAttempt >= 2) {
          const message = error instanceof Error ? error.message : String(error)
          throw new Error(`${message}: ${raw.slice(0, 1200)}`)
        }
        messages.push({
          role: 'assistant',
          content: raw,
        })
        messages.push({
          role: 'user',
          content: jsonRepairPrompt,
        })
      }
    }

    if (!decision) {
      throw new Error(lastRaw ? `模型决策解析失败: ${lastRaw}` : '模型决策解析失败')
    }

    messages.push({
      role: 'assistant',
      content: JSON.stringify(decision),
    })

    const thoughtText = decision.thought?.trim()
    if (thoughtText) {
      const thoughtStep = createStep({
        kind: 'plan',
        title: `第 ${turn + 1} 轮思考`,
        status: 'done',
        strategy: 'ReAct Thought',
        inputSummary: '',
        resultSummary: thoughtText,
        query: '',
      })
      trace.push(thoughtStep)
      options.onProgress?.(thoughtStep)
    }

    if (decision.action === 'finish') {
      finishReason = decision.finishReason?.trim() || `第 ${turn + 1} 轮判断证据已充足`
      finalAnswer = decision.finalAnswer
      if (options.requireFinalAnswer !== false && !finalAnswer) {
        throw new Error('模型结束时未返回 finalAnswer')
      }
      break
    }

    if (decision.action !== 'tool' || !decision.toolName) {
      throw new Error('模型返回的 ReAct 动作无效')
    }

    const tool = options.tools.find((item) => item.name === decision.toolName)
    if (!tool) {
      throw new Error(`模型请求了未注册工具: ${decision.toolName}`)
    }

    const toolInput = normalizeToolInput(decision.toolInput)
    if ((toolFailureHistory.get(tool.name) || 0) >= toolFailureLimit) {
      throw new Error(`工具 ${tool.name} 已失败超过 ${toolFailureLimit} 次，已中断循环`)
    }

    const runningStep = createStep({
      kind: 'tool',
      title: tool.name,
      status: 'running',
      tool: tool.name,
      strategy: 'ReAct Tool Call',
      inputSummary: JSON.stringify(toolInput),
      toolInputText: stringifyToolText(toolInput, '{}'),
      resultSummary: '执行中...',
      toolOutputText: '',
      query: tool.description,
    })
    options.onProgress?.(runningStep)

    try {
      throwIfAborted(options.abortSignal)
      const result = await tool.execute(toolInput, options.context)
      const finishedAt = Date.now()
      const doneStep: DiagnosisAgentStep = {
        ...runningStep,
        status: 'done',
        finishedAt,
        durationMs: finishedAt - runningStep.startedAt,
        resultSummary: result.summary || '工具执行完成',
        toolOutputText: stringifyToolText(result.observation, result.summary || '工具执行完成'),
      }
      trace.push(doneStep)
      options.onProgress?.(doneStep)

      messages.push({
        role: 'user',
        content: `TOOL_RESULT ${tool.name}: ${JSON.stringify({
          input: toolInput,
          summary: result.summary || '',
          empty: result.empty || false,
          resultCount: result.resultCount ?? null,
          sourceCount: result.sourceCount ?? null,
          retryable: result.retryable ?? false,
          observation: clipObservation(result.observation),
        })}\n\n${nextStepPrompt}`,
      })
    } catch (error) {
      const finishedAt = Date.now()
      const errorMessage = error instanceof Error ? error.message : String(error)
      toolFailureHistory.set(tool.name, (toolFailureHistory.get(tool.name) || 0) + 1)
      const errorStep: DiagnosisAgentStep = {
        ...runningStep,
        status: 'error',
        finishedAt,
        durationMs: finishedAt - runningStep.startedAt,
        resultSummary: errorMessage,
        toolOutputText: errorMessage,
      }
      trace.push(errorStep)
      options.onProgress?.(errorStep)
      messages.push({
        role: 'user',
        content: `TOOL_RESULT ${tool.name}: ${JSON.stringify({
          input: toolInput,
          error: errorMessage,
          failedCount: toolFailureHistory.get(tool.name) || 0,
          maxFailedCount: toolFailureLimit,
        })}\n\n${nextStepPrompt}`,
      })
    }
  }

  return {
    messages,
    trace,
    finishReason,
    finalAnswer,
  }
}
