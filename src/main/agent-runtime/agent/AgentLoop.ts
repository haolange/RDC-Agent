/**
 * AgentLoop — transition 状态机式 Agent 主循环。
 *
 * 设计对标 Claude Code `query.ts`：用显式 `LoopState` + 「State 重写 + continue」
 * 表达所有恢复/继续路径，单层 `while(true)` 直线流水线，线性可读可断言。
 *
 * transition 站点（每轮顶部快照 state，按 reason 分发）：
 * - `init`          注入初始 pending（用户消息），进入首轮。
 * - `next_turn`     正常工具循环：调 LLM → 执行工具 → 若有 toolUse 继续。
 * - `terminal`      终止（max_turns / 无 toolUse / abort）。
 *
 * 该模块只负责低层调度，不持有状态机或事件订阅；
 * 高层组合（队列、订阅、abort 协调）由 `Agent` 类负责。
 */

import { EventStream } from '../core/EventStream';
import type {
  AgentEvent,
  AgentMessage,
  AssistantMessage,
  Context,
  Message,
  Model,
  StreamOptions,
  ToolCall,
  ToolDefinition,
  ToolResultMessage,
  UserMessage,
} from '../core/types';
import type { ProviderStrategy } from '../core/ProviderRegistry';
import {
  AgentRecoveryAbortError,
  ErrorRecovery,
  isProviderStreamProtocolError,
  type RecoveryAction,
} from './ErrorRecovery';
import type { CompressResult } from './ContextManager';
import {
  AgentLoopTerminationError,
  LoopProgressGuard,
  RUNTIME_NO_PROGRESS_INSTRUCTION,
} from './LoopProgressGuard';

export type TransformContextResult = AgentMessage[] | CompressResult;

/** Handle returned by agentLoop: stream for consumers + producerCompletion for join. */
export interface AgentLoopHandle {
  stream: EventStream<AgentEvent, Message[]>;
  producerCompletion: Promise<void>;
}

// =====================================================================
// 配置 / 上下文 / 执行器接口
// =====================================================================

/** Agent Loop 配置。 */
export interface AgentLoopConfig {
  /** 当前模型描述。 */
  model: Model;
  /** 将 AgentMessage[] 转换为 LLM 可理解的 Message[]。 */
  convertToLlm: (messages: AgentMessage[]) => Message[];
  /** 可选：在 convertToLlm 之前变换上下文（如压缩、剪裁）。 */
  transformContext?: (
    messages: AgentMessage[],
    signal?: AbortSignal,
  ) => Promise<TransformContextResult>;
  /** LLM 调用选项（temperature/maxTokens 等）。 */
  streamOptions: StreamOptions;
  /**
   * Per-call output cap. Computed immediately before each provider request.
   * `null` means the remaining window cannot admit output — fail closed.
   */
  resolveMaxTokens?: (messages: Message[]) => number | null;
  /** 获取动态 API Key（支持 OAuth token 刷新）。 */
  getApiKey?: (provider: string) => Promise<string | undefined>;
  /** 最大工具执行轮数（防止无限循环）。 */
  maxTurns?: number;
  /** 工具并行执行的最大并发数。1 = 顺序（默认），0 或 >1 = 并发。 */
  maxToolConcurrency?: number;
  /** 外部 abort 信号；触发时会中止 provider 流并以 AbortError 终止。 */
  signal?: AbortSignal;
  /**
   * 后台任务运行器（可选）。
   *
   * 每轮 LLM 调用前调用 `buildNotificationMessage()`，将已完成但未通知的
   * 后台任务结果作为系统通知注入到上下文。使用接口而非具体类，避免循环依赖。
   */
  backgroundTaskRunner?: { buildNotificationMessage(): string | null };
  /**
   * Cron 调度器（可选）。
   *
   * 每轮 LLM 调用前调用 `getPendingPrompts()`，将到期的 cron 任务以
   * `<cron_triggered>...</cron_triggered>` 形式注入为 user 消息。
   */
  /** 错误恢复管理器（可选）。集成后 LLM 错误会触发自动重试/模型切换/压缩。 */
  errorRecovery?: ErrorRecovery;
  onRequest?: (input: {
    model: Model;
    context: Context;
    streamOptions: StreamOptions;
  }) => Promise<string | undefined> | string | undefined;
  onResponse?: (requestId: string | undefined, message: AssistantMessage) => Promise<void> | void;
}

/** Agent 上下文（messages 可在 loop 内增长；tools 经 runtime revision COW）。 */
export interface AgentContext {
  systemPrompt?: string;
  systemPromptSegments?: Context['systemPromptSegments'];
  messages: AgentMessage[];
  tools?: ToolDefinition[];
  /**
   * LoopRuntimeState 引用：每轮 LLM 调用读取 current.activeTools。
   * Deferred 激活 bump revision 后，下一轮自动用新工具集。
   */
  runtime?: { current: LoopRuntimeState };
}

/** Turn / loop 内工具与 deferred 激活的修订状态（不可变快照；更新时整体替换）。 */
export interface LoopRuntimeState {
  revision: number;
  activeTools: ToolDefinition[];
  activatedDeferredTools: ReadonlySet<string>;
}

/** AgentTool 执行器接口（具体实现见 Tool 子系统）。 */
export interface ToolExecutor {
  /**
   * 执行一次工具调用。
   * @param toolCall   待执行的工具调用。
   * @param signal     中止信号（来自 EventStream / Agent）。
   * @param onUpdate   工具执行过程中的增量回调（用于 UI 进度展示）。
   */
  execute(
    toolCall: ToolCall,
    signal?: AbortSignal,
    onUpdate?: (partialResult: unknown) => void,
  ): Promise<ToolResultMessage>;
}

/** 内层循环工具执行结果。 */
interface ExecuteToolCallsResult {
  results: ToolResultMessage[];
}

// =====================================================================
// 公开入口
// =====================================================================

/**
 * 启动 Agent Loop（低层 API）。
 *
 * @param pendingMessages  初始待处理的消息（通常是用户消息）。
 * @param context          Agent 上下文（会被原地修改）。
 * @param config           循环配置。
 * @param providerStrategy LLM Provider 策略。
 * @param toolExecutor     工具执行器；缺省时所有工具调用都会返回错误结果。
 * @returns                EventStream，最终结果是本次循环新增的所有消息。
 */
export function agentLoop(
  pendingMessages: UserMessage[],
  context: AgentContext,
  config: AgentLoopConfig,
  providerStrategy: ProviderStrategy,
  toolExecutor?: ToolExecutor,
): AgentLoopHandle {
  const stream = new EventStream<AgentEvent, Message[]>();
  let settleProducer!: () => void;
  const producerCompletion = new Promise<void>((resolve) => {
    settleProducer = resolve;
  });
  void runAgentLoop(
    [...pendingMessages],
    context,
    config,
    providerStrategy,
    toolExecutor,
    stream,
  ).finally(() => {
    settleProducer();
  });
  return { stream, producerCompletion };
}

/**
 * 从现有上下文继续循环（无新消息注入）。
 *
 * 适用于「外部已经把消息写入 context.messages、需要 agent 继续推理」的场景。
 */
export function agentLoopContinue(
  context: AgentContext,
  config: AgentLoopConfig,
  providerStrategy: ProviderStrategy,
  toolExecutor?: ToolExecutor,
): AgentLoopHandle {
  return agentLoop([], context, config, providerStrategy, toolExecutor);
}

// =====================================================================
// 主循环实现
// =====================================================================

/** transition reason：标记「本轮为何继续」，便于测试断言走了哪条路径。 */
type TransitionReason = 'init' | 'next_turn';

/** 显式循环状态。每轮顶部快照，恢复/继续路径用「重写 state + continue」表达。 */
interface LoopState {
  /** 待注入上下文的 pending 消息（用户消息）。 */
  pending: UserMessage[];
  /** 当前工具执行轮数。 */
  turn: number;
  /** 本轮 transition 原因。 */
  transition: TransitionReason;
}

async function runAgentLoop(
  pendingMessages: UserMessage[],
  context: AgentContext,
  config: AgentLoopConfig,
  providerStrategy: ProviderStrategy,
  toolExecutor: ToolExecutor | undefined,
  stream: EventStream<AgentEvent, Message[]>,
): Promise<void> {
  const newMessages: Message[] = [];
  const maxTurns = config.maxTurns ?? 100;
  const progressGuard = new LoopProgressGuard();
  let runtimeNoProgressInstruction: string | undefined;

  // 桥接外部 abort 信号到 stream
  const onExternalAbort = (): void => {
    if (!stream.isDone) {
      stream.abort();
    }
  };
  if (config.signal) {
    if (config.signal.aborted) {
      stream.abort();
      return;
    }
    config.signal.addEventListener('abort', onExternalAbort, { once: true });
  }

  // 注入 pending 消息到上下文 + 事件流的公共逻辑。
  const injectPending = (messages: UserMessage[]): void => {
    for (const msg of messages) {
      context.messages.push(msg);
      newMessages.push(msg);
      stream.push({ type: 'message_start', message: msg });
      stream.push({ type: 'message_end', message: msg });
    }
  };

  // Background Task & Cron 注入点：每轮 LLM 调用前注入已完成后台任务通知 + 到期 cron。
  const injectScheduled = (): void => {
    const injected: UserMessage[] = [];
    if (config.backgroundTaskRunner) {
      const notification = config.backgroundTaskRunner.buildNotificationMessage();
      if (notification) {
        injected.push({
          role: 'user',
          content: [{ type: 'text', text: notification }],
          timestamp: Date.now(),
        });
      }
    }
    injectPending(injected);
  };

  try {
    stream.push({ type: 'agent_start' });

    // 初始 state：pending = 用户消息，transition = init。
    let state: LoopState = {
      pending: [...pendingMessages],
      turn: 0,
      transition: 'init',
    };

    // ---- 单层主循环：transition 状态机 ----
    // eslint-disable-next-line no-constant-condition
    while (true) {
      // 1. 快照 state（transition 字段标记本轮来源，供测试断言）
      // 2. 注入 pending（init 站点携带 pending）
      if (state.pending.length > 0) {
        injectPending(state.pending);
        state = { ...state, pending: [] };
      }

      // 3. abort 检查
      if (stream.isDone) {
        return;
      }

      // 4. turn 计数 + max_turns 终止
      state = { ...state, turn: state.turn + 1 };
      if (state.turn > maxTurns) {
        throw new AgentLoopTerminationError(
          'AGENT_MAX_TURNS_EXCEEDED',
          `Agent still required tool-loop continuation after ${maxTurns} turns.`,
          { turn: state.turn - 1, maxTurns },
        );
      }
      stream.push({ type: 'turn_start', turn: state.turn });

      // 5. 注入 scheduled（background/cron）
      injectScheduled();

      // 6. 调用 LLM 生成助手消息（带错误恢复，内部是独立 transition 子状态机）
      const ephemeralInstruction = runtimeNoProgressInstruction;
      runtimeNoProgressInstruction = undefined;
      const { message: assistantMessage } = await streamAssistantResponseWithRecovery(
        context,
        config,
        providerStrategy,
        stream,
        ephemeralInstruction,
      );
      newMessages.push(assistantMessage);

      // 7. 非 toolUse 停止 → terminal
      if (assistantMessage.stopReason !== 'toolUse') {
        stream.push({ type: 'turn_end', turn: state.turn, message: assistantMessage });
        break;
      }

      // 8. 执行工具调用
      const toolResults = await executeToolCalls(
        assistantMessage,
        toolExecutor,
        stream,
        config.maxToolConcurrency,
      );
      for (const result of toolResults.results) {
        context.messages.push(result);
        newMessages.push(result);
      }
      stream.push({
        type: 'turn_end',
        turn: state.turn,
        message: assistantMessage,
        toolResults: toolResults.results,
      });

      const progress = progressGuard.observe(
        assistantMessage,
        toolResults.results,
        context.runtime?.current.revision ?? 0,
        context.runtime?.current.activeTools ?? context.tools ?? [],
      );
      if (progress.action === 'terminate') {
        throw new AgentLoopTerminationError(
          'AGENT_NO_PROGRESS',
          `Agent repeated the same tool round ${progress.consecutiveMatches} consecutive times without runtime progress.`,
          { turn: state.turn },
        );
      }
      if (progress.action === 'inject-guidance') {
        runtimeNoProgressInstruction = RUNTIME_NO_PROGRESS_INSTRUCTION;
      }

      // 9. next_turn 站点：正常工具循环继续
      state = { pending: [], turn: state.turn, transition: 'next_turn' };
    }

    stream.push({ type: 'agent_end', messages: newMessages });
    stream.complete(newMessages);
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    const aborted = stream.signal.aborted || error.name === 'AbortError';
    if (!stream.isDone) {
      stream.push({ type: 'error', error, aborted });
      stream.error(error);
    }
  } finally {
    if (config.signal) {
      config.signal.removeEventListener('abort', onExternalAbort);
    }
  }
}

// =====================================================================
// LLM 调用（含错误恢复）
// =====================================================================

function recoveryDiagnosticCode(action: RecoveryAction): string {
  return `error_recovery_${action.type}`;
}

function recoveryStartMessage(action: RecoveryAction, attempt: number): string {
  switch (action.type) {
    case 'retry':
      return `provider 错误，正在重试（第 ${attempt} 次）`;
    case 'reactive_compact':
      return '上下文过长，正在压缩历史消息';
    case 'switch_model':
      return '服务过载，正在切换备用模型';
    case 'continue_prompt':
      return '输出被截断，正在续写';
    default:
      return '';
  }
}

function emitRecoveryDiagnostic(
  stream: EventStream<AgentEvent, Message[]>,
  action: RecoveryAction,
  phase: 'started' | 'completed',
  attempt = 1,
): void {
  const code = recoveryDiagnosticCode(action);
  const message = phase === 'completed'
    ? '错误恢复成功，继续生成回复'
    : recoveryStartMessage(action, attempt);
  if (!message) {
    return;
  }
  stream.push({
    type: 'diagnostic',
    code,
    severity: 'info',
    message,
    phase,
  });
}

/**
 * 带 ErrorRecovery 的 LLM 调用包装。
 *
 * 调用 `streamAssistantResponse` 并捕获异常；若配置了 `errorRecovery`，
 * 则根据 RecoveryAction 执行 retry/escalate/compact/switch/abort 流程。
 */
async function streamAssistantResponseWithRecovery(
  context: AgentContext,
  config: AgentLoopConfig,
  provider: ProviderStrategy,
  stream: EventStream<AgentEvent, Message[]>,
  ephemeralInstruction?: string,
): Promise<{ message: AssistantMessage }> {
  const recovery = config.errorRecovery;
  const CIRCUIT_BREAKER_LIMIT = 3;
  let consecutiveCompactionFailures = 0;
  let pendingRecoveryAction: RecoveryAction | null = null;

  const completePendingRecovery = (): void => {
    if (!pendingRecoveryAction) {
      return;
    }
    emitRecoveryDiagnostic(stream, pendingRecoveryAction, 'completed');
    pendingRecoveryAction = null;
  };

  const beginRecovery = (action: RecoveryAction): void => {
    const attempt = (recovery?.getState().recoveryCount ?? 0) + 1;
    pendingRecoveryAction = action;
    emitRecoveryDiagnostic(stream, action, 'started', attempt);
  };

  for (;;) {
    try {
      const assistantMessage = await streamAssistantResponse(
        context,
        config,
        provider,
        stream,
        ephemeralInstruction,
      );
      // 成功时重置断路器
      consecutiveCompactionFailures = 0;

      // stopReason === 'length'：输出被截断，走恢复策略（reactive_compact / continue_prompt / abort）。
      if (recovery && assistantMessage.stopReason === 'length') {
        const lengthAction = recovery.decide(null, 'length');
        switch (lengthAction.type) {
          case 'reactive_compact': {
            beginRecovery(lengthAction);
            consecutiveCompactionFailures++;
            if (consecutiveCompactionFailures >= CIRCUIT_BREAKER_LIMIT) {
              throw new Error(
                `[Circuit breaker] ${CIRCUIT_BREAKER_LIMIT} consecutive compaction attempts failed; aborting`,
              );
            }
            recovery.markReactiveCompactAttempted();
            if (config.transformContext) {
              const compacted = await applyTransformContext(context.messages, config, stream);
              context.messages = compacted;
            }
            continue;
          }
          case 'continue_prompt': {
            beginRecovery(lengthAction);
            recovery.noteRetryAttempt();
            context.messages.push({
              role: 'user',
              content: [{ type: 'text', text: 'Continue.' }],
              timestamp: Date.now(),
            });
            continue;
          }
          case 'abort': {
            throw new Error(`[Recovery abort] ${lengthAction.reason}`);
          }
          default: {
            completePendingRecovery();
            return { message: assistantMessage };
          }
        }
      }

      completePendingRecovery();
      return { message: assistantMessage };
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));

      if (!recovery) {
        throw error;
      }

      const action = recovery.decide(error);

      switch (action.type) {
        case 'retry': {
          beginRecovery(action);
          recovery.noteRetryAttempt();
          await sleep(action.delayMs, stream.signal);
          continue;
        }
        case 'reactive_compact': {
          beginRecovery(action);
          consecutiveCompactionFailures++;
          if (consecutiveCompactionFailures >= CIRCUIT_BREAKER_LIMIT) {
            throw new Error(
              `[Circuit breaker] ${CIRCUIT_BREAKER_LIMIT} consecutive compaction attempts failed; aborting`,
            );
          }
          recovery.markReactiveCompactAttempted();
          if (config.transformContext) {
            context.messages = await applyTransformContext(
              context.messages,
              config,
              stream,
            );
          }
          continue;
        }
        case 'switch_model': {
          beginRecovery(action);
          config.model = action.fallbackModel;
          continue;
        }
        case 'continue_prompt': {
          beginRecovery(action);
          recovery.noteRetryAttempt();
          continue;
        }
        case 'abort': {
          throw createRecoveryAbortError(error, action.reason);
        }
      }
    }
  }
}

function createRecoveryAbortError(original: Error, reason: string): Error {
  if (isProviderStreamProtocolError(original) || original instanceof AgentRecoveryAbortError) {
    const streamCode = original instanceof AgentRecoveryAbortError
      ? original.streamCode
      : typeof original.code === 'string' ? original.code : undefined;
    return new AgentRecoveryAbortError(`[Recovery abort] ${reason}`, streamCode);
  }
  return new Error(`[Recovery abort] ${reason}`);
}

function createAbortError(): Error {
  const err = new Error('Aborted');
  err.name = 'AbortError';
  return err;
}

/** Abort-aware async delay used by recovery retry. */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(createAbortError());
  }
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const onAbort = (): void => {
      cleanup();
      reject(createAbortError());
    };
    const cleanup = (): void => {
      clearTimeout(t);
      signal?.removeEventListener('abort', onAbort);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * 调用 LLM 生成一条助手消息，并把流事件转发到主事件流。
 *
 * 注意：
 * - context.messages 在 transformContext 之前是只读语义（拷贝传入），
 *   transformContext 不应原地修改。
 * - provider stream 阶段我们会向 context.messages 临时插入 partial 助手消息，
 *   确保 UI 可以渐进式渲染；最终 done/error 时替换为完整消息。
 */
async function streamAssistantResponse(
  context: AgentContext,
  config: AgentLoopConfig,
  provider: ProviderStrategy,
  stream: EventStream<AgentEvent, Message[]>,
  ephemeralInstruction?: string,
): Promise<AssistantMessage> {
  // 1. 可选的上下文变换（压缩 / 剪裁）
  let messages: AgentMessage[] = context.messages;
  if (config.transformContext) {
    messages = await applyTransformContext(context.messages, config, stream);
  }
  if (ephemeralInstruction) {
    messages = [
      ...messages,
      {
        role: 'user',
        content: [{ type: 'text', text: ephemeralInstruction }],
        timestamp: Date.now(),
      },
    ];
  }

  // 2. 转换为 LLM Message[]
  const llmMessages = config.convertToLlm(messages);
  let resolvedMaxTokens = config.streamOptions.maxTokens;
  if (config.resolveMaxTokens) {
    const dynamicMaxTokens = config.resolveMaxTokens(llmMessages);
    if (dynamicMaxTokens == null || dynamicMaxTokens <= 0) {
      throw new Error(
        'CONTEXT_CANNOT_FIT: remaining context window cannot admit any output tokens.',
      );
    }
    resolvedMaxTokens = dynamicMaxTokens;
  }

  // 3. 构建 LLM Context（tools 优先读 runtime.current，支持 deferred COW revision）
  const llmContext: Context = {
    systemPrompt: context.systemPrompt,
    systemPromptSegments: context.systemPromptSegments,
    messages: llmMessages,
    tools: context.runtime?.current.activeTools ?? context.tools,
  };

  // 4. 解析 API key（优先动态获取）
  const dynamicKey = config.getApiKey
    ? await config.getApiKey(config.model.provider)
    : undefined;
  const apiKey = dynamicKey ?? config.streamOptions.apiKey;

  // 5. 合并 stream options，传入 abort 信号
  const streamOptions: StreamOptions = {
    ...config.streamOptions,
    ...(typeof resolvedMaxTokens === 'number' ? { maxTokens: resolvedMaxTokens } : {}),
    apiKey,
    signal: stream.signal,
  };

  const requestId = await config.onRequest?.({ model: config.model, context: llmContext, streamOptions });

  // 6. 调用 provider，转发事件
  const response = provider.stream(config.model, llmContext, streamOptions);

  let partialIndex = -1;
  let finalMessage: AssistantMessage | undefined;

  for await (const event of response) {
    switch (event.type) {
      case 'start': {
        // 把 partial assistant message 临时挂到 context 末尾，便于 UI 渲染
        partialIndex = context.messages.length;
        context.messages.push(event.partial);
        stream.push({ type: 'message_start', message: event.partial });
        break;
      }
      case 'text_start':
      case 'text_delta':
      case 'text_end':
      case 'thinking_start':
      case 'thinking_delta':
      case 'thinking_end':
      case 'toolcall_start':
      case 'toolcall_delta':
      case 'toolcall_end': {
        if (partialIndex >= 0) {
          context.messages[partialIndex] = event.partial;
        }
        stream.push({
          type: 'message_update',
          assistantMessageEvent: event,
          message: event.partial,
        });
        break;
      }
      case 'done': {
        finalMessage = event.message;
        if (partialIndex >= 0) {
          context.messages[partialIndex] = finalMessage;
        } else {
          context.messages.push(finalMessage);
          partialIndex = context.messages.length - 1;
        }
        stream.push({ type: 'message_end', message: finalMessage });
        break;
      }
      case 'error': {
        finalMessage = event.message;
        if (partialIndex >= 0) {
          context.messages[partialIndex] = finalMessage;
        } else {
          context.messages.push(finalMessage);
          partialIndex = context.messages.length - 1;
        }
        stream.push({ type: 'message_end', message: finalMessage });
        break;
      }
      default: {
        // 其它事件透传给 UI
        stream.push({
          type: 'message_update',
          assistantMessageEvent: event as never,
          message: (event as { partial: AssistantMessage }).partial,
        });
        break;
      }
    }
  }

  if (!finalMessage) {
    finalMessage = await response.result();
    if (partialIndex >= 0) {
      context.messages[partialIndex] = finalMessage;
    } else {
      context.messages.push(finalMessage);
    }
  }

  await config.onResponse?.(requestId, finalMessage);

  return finalMessage;
}

// =====================================================================
// 工具执行
// =====================================================================

/**
 * 执行助手消息中的工具调用（支持并发）。
 */
async function executeToolCalls(
  assistantMessage: AssistantMessage,
  toolExecutor: ToolExecutor | undefined,
  stream: EventStream<AgentEvent, Message[]>,
  maxConcurrency?: number,
): Promise<ExecuteToolCallsResult> {
  const toolCalls = assistantMessage.content.filter(
    (c): c is ToolCall => c.type === 'toolCall',
  );
  const results: ToolResultMessage[] = new Array(toolCalls.length);
  const concurrency = maxConcurrency && maxConcurrency > 1 ? maxConcurrency : 1;

  // 单个工具调用执行逻辑
  const executeOne = async (index: number): Promise<void> => {
    const toolCall = toolCalls[index];
    const startTime = Date.now();

    stream.push({
      type: 'tool_execution_start',
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      args: toolCall.arguments,
    });

    let result: ToolResultMessage;
    if (toolExecutor) {
      try {
        result = await toolExecutor.execute(
          toolCall,
          stream.signal,
          (partial) => {
            stream.push({
              type: 'tool_execution_update',
              toolCallId: toolCall.id,
              toolName: toolCall.name,
              partialResult: partial,
            });
          },
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        result = {
          role: 'toolResult',
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          content: [{ type: 'text', text: `Error: ${message}` }],
          isError: true,
          timestamp: Date.now(),
        };
      }
    } else {
      result = {
        role: 'toolResult',
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        content: [
          { type: 'text', text: `Tool "${toolCall.name}" not available (no executor configured)` },
        ],
        isError: true,
        timestamp: Date.now(),
      };
    }

    stream.push({
      type: 'tool_execution_end',
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      result,
      durationMs: Date.now() - startTime,
    });
    results[index] = result;
  };

  // 并发执行
  for (let i = 0; i < toolCalls.length; i += concurrency) {
    const batch = [];
    for (let j = i; j < Math.min(i + concurrency, toolCalls.length); j++) {
      batch.push(executeOne(j));
    }
    await Promise.all(batch);
  }

  return { results: results.filter(Boolean) as ToolResultMessage[] };
}

async function applyTransformContext(
  currentMessages: AgentMessage[],
  config: AgentLoopConfig,
  stream: EventStream<AgentEvent, Message[]>,
): Promise<AgentMessage[]> {
  if (!config.transformContext) {
    return currentMessages;
  }
  const result = await config.transformContext([...currentMessages], stream.signal);
  if (Array.isArray(result)) {
    return result;
  }
  if (result.summary) {
    stream.push({ type: 'compaction', summary: result.summary });
  }
  return result.messages;
}
