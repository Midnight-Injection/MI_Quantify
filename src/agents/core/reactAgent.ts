import { useAiChat } from '@/composables/useAiChat'
import type { AiMessage, AiProvider, DiagnosisAgentStep } from '@/types'

type JsonRecord = Record<string, unknown>

interface ReActDecision {
  thought?: string
  action?: 'tool' | 'finish'
  toolName?: string
  toolInput?: JsonRecord
  finishReason?: string
}

export interface ReActToolResult {
  observation?: unknown
  summary?: string
}

export interface ReActTool<TContext = void> {
  name: string
  description: string
  inputSchema?: JsonRecord
  execute: (input: JsonRecord, context: TContext) => Promise<ReActToolResult>
}

export interface ReActLoopOptions<TContext = void> {
  provider: AiProvider
  context: TContext
  tools: ReActTool<TContext>[]
  systemPrompt: string
  userPrompt: string
  maxTurns?: number
  toolTemperature?: number
  toolMaxTokens?: number
  planInputSummary?: string
  planQuery?: string
  onProgress?: (step: DiagnosisAgentStep) => void
  abortSignal?: AbortSignal
}

export interface ReActLoopResult {
  messages: AiMessage[]
  trace: DiagnosisAgentStep[]
  finishReason: string
}

function parseJsonBlock<T>(raw: string): T {
  const matched = raw.match(/```json\s*([\s\S]*?)\s*```/) || raw.match(/\{[\s\S]*\}/)
  if (!matched) {
    throw new Error('模型未返回合法 JSON')
  }
  return JSON.parse(matched[1] || matched[0]) as T
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
  if (text.length <= 6000) return value
  return {
    truncated: true,
    preview: text.slice(0, 6000),
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

export async function runReActLoop<TContext>(options: ReActLoopOptions<TContext>): Promise<ReActLoopResult> {
  const { chat } = useAiChat()
  const trace: DiagnosisAgentStep[] = []
  const messages: AiMessage[] = [
    {
      role: 'system',
      content: `${options.systemPrompt}

你必须严格遵守以下 ReAct 输出协议：
1. 每一轮只能输出一个 JSON 对象。
2. JSON 结构只能是：
{"thought":"本轮思考","action":"tool","toolName":"工具名","toolInput":{...}}
或
{"thought":"本轮思考","action":"finish","finishReason":"已经拿到足够证据"}
3. 只能使用给定工具，不能伪造工具结果。
4. 如果关键数据还没拿到，优先继续调工具，不要提前 finish。
5. 只有当后续工具依赖股票代码且当前无法从上下文确认代码时，才先解决股票识别；能用名称或关键词直接查询的工具可以先执行。
6. 所有输出必须是合法 JSON，不要输出解释、Markdown 或代码块外文本。`,
    },
    {
      role: 'user',
      content: `${options.userPrompt}

可用工具：
${stringifyToolCatalog(options.tools)}`,
    },
  ]

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
  const toolCallHistory = new Map<string, number>()

  for (let turn = 0; turn < Math.max(1, options.maxTurns || 8); turn += 1) {
    throwIfAborted(options.abortSignal)
    const raw = await chat(
      options.provider,
      messages,
      {
        temperature: options.toolTemperature ?? 0.1,
        maxTokens: options.toolMaxTokens ?? 900,
        signal: options.abortSignal,
      },
    )

    const decision = parseJsonBlock<ReActDecision>(raw)
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
    const toolCallKey = `${tool.name}:${JSON.stringify(toolInput)}`
    const repeated = (toolCallHistory.get(toolCallKey) || 0) + 1
    toolCallHistory.set(toolCallKey, repeated)
    if (repeated > 2) {
      throw new Error(`工具 ${tool.name} 重复调用过多，已中断循环`)
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
          observation: clipObservation(result.observation),
        })}`,
      })
    } catch (error) {
      const finishedAt = Date.now()
      const errorMessage = error instanceof Error ? error.message : String(error)
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
        })}`,
      })
    }
  }

  return {
    messages,
    trace,
    finishReason,
  }
}
