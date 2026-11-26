import { AppError } from '@shared/errors/appError';
import { assertNever } from '@shared/utils/assertNever';
import { appendRuntimePermissionContext } from '../permissions/RuntimePermissionContext';
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
import { AgentRecoveryAbortError, ErrorRecovery, type RecoveryAction } from './ErrorRecovery';
import { AgentLoopTerminationError, LoopProgressGuard, RUNTIME_NO_PROGRESS_INSTRUCTION } from './LoopProgressGuard';
import { executeToolCalls } from './ToolCallDispatch';
import { RuntimeContinuationGuard } from './RuntimeContinuation';
import { recoveryStartMessage } from './RecoveryDiagnosticText';
import type { CompressResult } from './ContextManager';
import type { ProviderStrategy } from '../core/ProviderRegistry';
import type {
  AgentLoopEvent,
  AgentMessage,
  AssistantMessage,
  AssistantMessageEvent,
  Context,
  Message,
  Model,
  StreamOptions,
  ToolCallContent,
  ToolDefinition,
  ToolResultMessage,
  UserMessage,
} from '../core/types';
import type { RuntimePermissionState } from '@shared/types/runtimePermission';
import type { ToolCall } from '@shared/types/tool';

export type TransformContextResult = AgentMessage[] | CompressResult;

/** Handle returned by agentLoop: stream for consumers + producerCompletion for join. */
export interface AgentLoopHandle {
  stream: EventStream<AgentLoopEvent, Message[]>;
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
    onProgress?: (progress: import('@shared/types/agentRuntime').AgentContextCompactedPayload) => void,
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
  /** 错误恢复管理器（可选）。集成后 LLM 错误会触发自动重试/模型切换/压缩。 */
  errorRecovery?: ErrorRecovery;
  onRequest?: (input: {
    model: Model;
    context: Context;
    streamOptions: StreamOptions;
    mailboxDeliveries?: import('@shared/types/rdcRuntime').RequestEnvelopeSnapshot['mailboxDeliveries'];
  }) => Promise<string | undefined> | string | undefined;
  onResponse?: (requestId: string | undefined, message: AssistantMessage) => Promise<void> | void;
  resolvePermissionState?: () => RuntimePermissionState;
  beforeRequestMessages?: () => Promise<{
    messages: Message[];
    mailboxDeliveries?: import('@shared/types/rdcRuntime').RequestEnvelopeSnapshot['mailboxDeliveries'];
    commit?: () => Promise<void>;
  }>;
  /** Runtime-owned incomplete obligation, or undefined when this response may end. */
  beforeTerminalResponse?: (message: AssistantMessage) => Promise<string | undefined>;
  onLoopBudget?: (remaining: number, limit: number) => void;
  resolvePromptPlan?: () => Pick<import('@shared/types/rdcRuntime').PromptPlan, 'systemPrompt' | 'segments'>;
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
  /** Host-owned successful tool boundary; never inferred from model text. */
  shouldEndTurnAfterToolResult?(result: ToolResultMessage): boolean;
  /**
   * 执行一次工具调用。
   * @param toolCall   待执行的工具调用。
   * @param signal     中止信号（来自 EventStream / Agent）。
   * @param onUpdate   工具执行过程中的增量回调（用于 UI 进度展示）。
   * @param onExecutionStart 授权、前置检查及资源排队完成后，实际进入工具 effect 时通知一次。
   */
  execute(
    toolCall: ToolCallContent,
    signal?: AbortSignal,
    onUpdate?: (partialResult: unknown) => void,
    onExecutionStart?: (permissionState?: RuntimePermissionState) => void,
  ): Promise<ToolResultMessage>;
  /** Missing implementation defaults to unsafe (serial). */
  isConcurrencySafe?(toolCall: ToolCall): boolean;
  /** Atomically reserve shared budget for a dispatch group. Failure means the group does not start. */
  reserveDispatchBudget?(toolCalls: ToolCall[]): { ok: true } | { ok: false; limit: string };
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
  const stream = new EventStream<AgentLoopEvent, Message[]>();
  let settleProducer!: () => void;
  const producerCompletion = new Promise<void>((resolve) => {
    settleProducer = resolve;
  });
  void runAgentLoop([...pendingMessages], context, config, providerStrategy, toolExecutor, stream).finally(() => {
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

/** State one loop run carries across its turns; the phases below read and update it. */
interface AgentLoopRun {
  readonly context: AgentContext;
  readonly config: AgentLoopConfig;
  readonly providerStrategy: ProviderStrategy;
  readonly toolExecutor: ToolExecutor | undefined;
  readonly stream: EventStream<AgentLoopEvent, Message[]>;
  /** Every message this run added; the stream's result. */
  readonly newMessages: Message[];
  readonly maxTurns: number;
  readonly progressGuard: LoopProgressGuard;
  readonly continuationGuard: RuntimeContinuationGuard;
  /** Request-local host instructions for the next provider request only; consumed when it is built. */
  runtimeNoProgressInstruction: string | undefined;
  runtimeContinuationInstruction: string | undefined;
}

/** How one turn left the loop: on to the next turn, a normal end, or an abort seen between turns. */
type TurnOutcome = { kind: 'continue'; state: LoopState } | { kind: 'end' } | { kind: 'aborted' };

async function runAgentLoop(
  pendingMessages: UserMessage[],
  context: AgentContext,
  config: AgentLoopConfig,
  providerStrategy: ProviderStrategy,
  toolExecutor: ToolExecutor | undefined,
  stream: EventStream<AgentLoopEvent, Message[]>,
): Promise<void> {
  const run: AgentLoopRun = {
    context,
    config,
    providerStrategy,
    toolExecutor,
    stream,
    newMessages: [],
    maxTurns: config.maxTurns ?? Infinity,
    progressGuard: new LoopProgressGuard(),
    continuationGuard: new RuntimeContinuationGuard(),
    runtimeNoProgressInstruction: undefined,
    runtimeContinuationInstruction: undefined,
  };

  const unsubscribeExternalAbort = subscribeExternalAbort(config.signal, stream);
  if (!unsubscribeExternalAbort) return;

  try {
    stream.push({ type: 'agent_start' });
    if (!(await runTurns(run, pendingMessages))) return;
    stream.push({ type: 'agent_end', messages: run.newMessages });
    stream.complete(run.newMessages);
  } catch (err) {
    failLoop(stream, err);
  } finally {
    unsubscribeExternalAbort();
  }
}

/**
 * Bridges the external abort signal to the stream. Returns the unsubscribe, or undefined when the signal had already
 * fired: the stream is then aborted and the loop never starts.
 */
function subscribeExternalAbort(
  signal: AbortSignal | undefined,
  stream: EventStream<AgentLoopEvent, Message[]>,
): (() => void) | undefined {
  if (!signal) return () => {};
  if (signal.aborted) {
    stream.abort();
    return undefined;
  }
  const onExternalAbort = (): void => {
    if (!stream.isDone) {
      stream.abort();
    }
  };
  signal.addEventListener('abort', onExternalAbort, { once: true });
  return () => signal.removeEventListener('abort', onExternalAbort);
}

/** A thrown loop failure ends the stream with an error event, unless the stream already finished. */
function failLoop(stream: EventStream<AgentLoopEvent, Message[]>, err: unknown): void {
  const error = err instanceof Error ? err : new Error(String(err));
  const aborted = stream.signal.aborted || error.name === 'AbortError';
  if (!stream.isDone) {
    stream.push({ type: 'error', error, aborted });
    stream.error(error);
  }
}

/** The single-level transition state machine. Resolves false when the stream was aborted between turns. */
async function runTurns(run: AgentLoopRun, pendingMessages: UserMessage[]): Promise<boolean> {
  // 初始 state：pending = 用户消息，transition = init。
  let state: LoopState = {
    pending: [...pendingMessages],
    turn: 0,
    transition: 'init',
  };
  while (true) {
    const outcome = await runTurn(run, state);
    if (outcome.kind !== 'continue') return outcome.kind === 'end';
    state = outcome.state;
  }
}

/** One turn: one provider request, then either the terminal check or one tool round. */
async function runTurn(run: AgentLoopRun, previous: LoopState): Promise<TurnOutcome> {
  const state = beginTurn(run, previous);
  if (!state) return { kind: 'aborted' };
  const { config, maxTurns } = run;

  // 5. 调用 LLM 生成助手消息（带错误恢复，内部是独立 transition 子状态机）
  const remainingTurns = maxTurns - state.turn + 1;
  config.onLoopBudget?.(remainingTurns, maxTurns);
  const ephemeralInstruction = takeEphemeralInstruction(run, remainingTurns);
  const { message: assistantMessage } = await streamAssistantResponseWithRecovery(
    run.context,
    config,
    run.providerStrategy,
    run.stream,
    ephemeralInstruction,
    remainingTurns > 1,
  );
  run.newMessages.push(assistantMessage);

  if (remainingTurns === 1 && assistantMessage.stopReason === 'toolUse') {
    throw new AgentLoopTerminationError(
      'AGENT_MAX_TURNS_EXCEEDED',
      'Provider requested a tool after the final text-only request.',
      { turn: state.turn, maxTurns },
    );
  }

  // 7. 非 toolUse 停止 → terminal
  if (assistantMessage.stopReason !== 'toolUse') return settleTerminalResponse(run, state, assistantMessage);
  return runToolRound(run, state, assistantMessage);
}

/** Injects pending messages, checks for abort and counts the turn; undefined when the stream is already done. */
function beginTurn(run: AgentLoopRun, previous: LoopState): LoopState | undefined {
  const { stream, maxTurns } = run;
  let state = previous;
  // 1. 快照 state（transition 字段标记本轮来源，供测试断言）
  // 2. 注入 pending（init 站点携带 pending）
  if (state.pending.length > 0) {
    injectPending(run, state.pending);
    state = { ...state, pending: [] };
  }

  // 3. abort 检查
  if (stream.isDone) {
    return undefined;
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
  return state;
}

/** 注入 pending 消息到上下文 + 事件流的公共逻辑。 */
function injectPending(run: AgentLoopRun, messages: UserMessage[]): void {
  for (const msg of messages) {
    run.context.messages.push(msg);
    run.newMessages.push(msg);
    run.stream.push({ type: 'message_start', message: msg });
    run.stream.push({ type: 'message_end', message: msg });
  }
}

/** The request-local host facts for this request; the one-shot instructions are consumed here. */
function takeEphemeralInstruction(run: AgentLoopRun, remainingTurns: number): string | undefined {
  // Request-local host facts ride at the end of the request so the cached prefix stays intact.
  const ephemeralInstruction =
    [
      run.runtimeContinuationInstruction,
      run.runtimeNoProgressInstruction,
      turnBudgetInstruction(remainingTurns, run.maxTurns),
    ]
      .filter((instruction): instruction is string => Boolean(instruction))
      .join('\n\n') || undefined;
  run.runtimeNoProgressInstruction = undefined;
  run.runtimeContinuationInstruction = undefined;
  return ephemeralInstruction;
}

function turnBudgetInstruction(remainingTurns: number, maxTurns: number): string | undefined {
  return remainingTurns <= 5
    ? [
        `<runtime_turn_budget remaining="${remainingTurns}" limit="${maxTurns}">`,
        remainingTurns === 1
          ? 'This is the final, text-only provider request in this turn. No tools are offered. Give the canonical final answer now, accurately marking unfinished work and unresolved evidence; do not claim structured completion unless it was already recorded.'
          : remainingTurns === 2
            ? 'This is the last request with tools. Settle open Tasks and call turn_complete now if a structured declaration is required; the next and final request is text-only. Preserve a truthful checkpoint and all approval, identity, experiment-restoration, and completion gates. Do not invent missing evidence.'
            : 'The turn is near its request limit. Prioritize settling open Tasks, preserving a truthful checkpoint when available, and producing an honest final answer before the limit. Keep all approval, identity, experiment-restoration, and completion gates intact; do not invent missing evidence.',
        '</runtime_turn_budget>',
      ].join('\n')
    : undefined;
}

/** A response without tool use ends the loop, unless a runtime-owned obligation asks for one more request. */
async function settleTerminalResponse(
  run: AgentLoopRun,
  state: LoopState,
  assistantMessage: AssistantMessage,
): Promise<TurnOutcome> {
  const { config, stream, maxTurns } = run;
  const remainingTurns = maxTurns - state.turn + 1;
  stream.push({ type: 'turn_end', turn: state.turn, message: assistantMessage });
  const continuation = await run.continuationGuard.next({
    reason: assistantMessage.stopReason,
    isDone: stream.isDone,
    remaining: remainingTurns,
    turn: state.turn,
    maxTurns,
    check: config.beforeTerminalResponse ? () => config.beforeTerminalResponse!(assistantMessage) : undefined,
  });
  if (continuation) {
    run.runtimeContinuationInstruction = continuation;
    return { kind: 'continue', state: { pending: [], turn: state.turn, transition: 'next_turn' } };
  }
  return { kind: 'end' };
}

/** 执行工具调用, then the host turn boundary and the no-progress guard decide whether the loop goes on. */
async function runToolRound(
  run: AgentLoopRun,
  state: LoopState,
  assistantMessage: AssistantMessage,
): Promise<TurnOutcome> {
  const { context, stream, toolExecutor } = run;
  // 8. 执行工具调用
  const toolResults = await executeToolCalls(assistantMessage, toolExecutor, stream, run.config.maxToolConcurrency);
  run.continuationGuard.reset();
  for (const result of toolResults.results) {
    context.messages.push(result);
    run.newMessages.push(result);
  }
  stream.push({
    type: 'turn_end',
    turn: state.turn,
    message: assistantMessage,
    toolResults: toolResults.results,
  });

  if (toolResults.results.some((result) => toolExecutor?.shouldEndTurnAfterToolResult?.(result))) {
    return { kind: 'end' };
  }

  const progress = run.progressGuard.observe(
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
    run.runtimeNoProgressInstruction = RUNTIME_NO_PROGRESS_INSTRUCTION;
  }

  // 9. next_turn 站点：正常工具循环继续
  return { kind: 'continue', state: { pending: [], turn: state.turn, transition: 'next_turn' } };
}

// =====================================================================
// LLM 调用（含错误恢复）
// =====================================================================

function recoveryDiagnosticCode(action: RecoveryAction): string {
  return `error_recovery_${action.type}`;
}

function emitRecoveryDiagnostic(
  stream: EventStream<AgentLoopEvent, Message[]>,
  action: RecoveryAction,
  phase: 'started' | 'completed',
  attempt = 1,
): void {
  const code = recoveryDiagnosticCode(action);
  const message = phase === 'completed' ? '错误恢复成功，继续生成回复' : recoveryStartMessage(action, attempt);
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
  stream: EventStream<AgentLoopEvent, Message[]>,
  ephemeralInstruction?: string,
  allowToolUse = true,
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
        allowToolUse,
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
              await applyTransformContext(context.messages, config, stream);
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
            throw createRecoveryAbortError(new Error(lengthAction.reason), lengthAction.reason, recovery);
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
              { cause: err },
            );
          }
          recovery.markReactiveCompactAttempted();
          if (config.transformContext) {
            await applyTransformContext(context.messages, config, stream);
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
          throw createRecoveryAbortError(error, action.reason, recovery);
        }
      }
    }
  }
}

function createRecoveryAbortError(original: Error, reason: string, recovery: ErrorRecovery): AgentRecoveryAbortError {
  return recovery.createAbortError(original, reason);
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
  stream: EventStream<AgentLoopEvent, Message[]>,
  ephemeralInstruction?: string,
  allowToolUse = true,
): Promise<AssistantMessage> {
  const { llmContext, streamOptions, pendingMailbox } = await buildProviderRequest(
    context,
    config,
    stream,
    ephemeralInstruction,
    allowToolUse,
  );
  const requestId = await config.onRequest?.({
    model: config.model,
    context: llmContext,
    streamOptions,
    mailboxDeliveries: pendingMailbox?.mailboxDeliveries,
  });
  await pendingMailbox?.commit?.();
  if (pendingMailbox?.messages.length) context.messages.push(...pendingMailbox.messages);

  // 6. 调用 provider，转发事件
  const response: ProviderResponseState = { partialIndex: -1, finalMessage: undefined };
  try {
    const providerStream = provider.stream(config.model, llmContext, streamOptions);
    for await (const event of providerStream) {
      forwardProviderEvent(event, response, context, stream);
    }

    if (!response.finalMessage) {
      response.finalMessage = await providerStream.result();
      placeAssistantMessage(response, context, response.finalMessage);
    }

    await config.onResponse?.(requestId, response.finalMessage);
    return response.finalMessage;
  } catch (error) {
    // A failed provider attempt cannot leave an assistant tool call in the next
    // request without a tool result. The streamed UI events remain diagnostic.
    if (response.partialIndex >= 0) context.messages.splice(response.partialIndex, 1);
    throw error;
  }
}

type RequestMailbox = Awaited<ReturnType<NonNullable<AgentLoopConfig['beforeRequestMessages']>>>;

/** One provider request as sent: the LLM context, the merged stream options and the mailbox tail it carries. */
interface ProviderRequest {
  llmContext: Context;
  streamOptions: StreamOptions;
  pendingMailbox: RequestMailbox | undefined;
}

/** Steps 1–5: the request's messages, output cap, context, API key and stream options. */
async function buildProviderRequest(
  context: AgentContext,
  config: AgentLoopConfig,
  stream: EventStream<AgentLoopEvent, Message[]>,
  ephemeralInstruction: string | undefined,
  allowToolUse: boolean,
): Promise<ProviderRequest> {
  // 1. 可选的上下文变换（压缩 / 剪裁）
  let messages: AgentMessage[] = context.messages;
  const pendingMailbox = await config.beforeRequestMessages?.();
  if (pendingMailbox?.messages.length) messages = [...messages, ...pendingMailbox.messages];
  // The compacted window covers durable history only; the request-local tail is appended after it,
  // so the next request still matches the installed window and the tail never counts as user input.
  if (config.transformContext) messages = await applyTransformContext(messages, config, stream);
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
      throw new AppError('CONTEXT_CANNOT_FIT', 'remaining context window cannot admit any output tokens.');
    }
    resolvedMaxTokens = dynamicMaxTokens;
  }

  // 3. 构建 LLM Context（tools 优先读 runtime.current，支持 deferred COW revision）
  const currentPrompt = config.resolvePromptPlan?.();
  let llmContext: Context = {
    systemPrompt: currentPrompt?.systemPrompt ?? context.systemPrompt,
    systemPromptSegments: currentPrompt?.segments ?? context.systemPromptSegments,
    messages: llmMessages,
    tools: allowToolUse ? (context.runtime?.current.activeTools ?? context.tools) : [],
  };

  // 4. 解析 API key（优先动态获取）
  const dynamicKey = config.getApiKey ? await config.getApiKey(config.model.provider) : undefined;
  const apiKey = dynamicKey ?? config.streamOptions.apiKey;

  // 5. 合并 stream options，传入 abort 信号
  const streamOptions: StreamOptions = {
    ...config.streamOptions,
    ...(typeof resolvedMaxTokens === 'number' ? { maxTokens: resolvedMaxTokens } : {}),
    apiKey,
    signal: stream.signal,
  };

  if (config.resolvePermissionState)
    Object.assign(llmContext, appendRuntimePermissionContext(llmContext, config.resolvePermissionState()));
  return { llmContext, streamOptions, pendingMailbox };
}

/** Where the streamed assistant message sits in `context.messages`, and the final message once the provider sent it. */
interface ProviderResponseState {
  partialIndex: number;
  finalMessage: AssistantMessage | undefined;
}

/** Forwards one provider event to the loop stream and keeps the partial assistant message in the context current. */
function forwardProviderEvent(
  event: AssistantMessageEvent,
  response: ProviderResponseState,
  context: AgentContext,
  stream: EventStream<AgentLoopEvent, Message[]>,
): void {
  switch (event.type) {
    case 'start': {
      // 把 partial assistant message 临时挂到 context 末尾，便于 UI 渲染
      response.partialIndex = context.messages.length;
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
      if (response.partialIndex >= 0) {
        context.messages[response.partialIndex] = event.partial;
      }
      stream.push({
        type: 'message_update',
        assistantMessageEvent: event,
        message: event.partial,
      });
      break;
    }
    case 'done': {
      response.finalMessage = event.message;
      placeAssistantMessage(response, context, event.message);
      stream.push({ type: 'message_end', message: event.message });
      break;
    }
    case 'error': {
      placeAssistantMessage(response, context, event.message);
      throw event.error;
    }
    default:
      assertNever(event);
  }
}

/** Replaces the partial assistant message, or appends the message when no partial was streamed. */
function placeAssistantMessage(
  response: ProviderResponseState,
  context: AgentContext,
  message: AssistantMessage,
): void {
  if (response.partialIndex >= 0) {
    context.messages[response.partialIndex] = message;
  } else {
    response.partialIndex = context.messages.length;
    context.messages.push(message);
  }
}

async function applyTransformContext(
  currentMessages: AgentMessage[],
  config: AgentLoopConfig,
  stream: EventStream<AgentLoopEvent, Message[]>,
): Promise<AgentMessage[]> {
  if (!config.transformContext) {
    return currentMessages;
  }
  let reported = false as boolean;
  const result = await config.transformContext([...currentMessages], stream.signal, (progress) => {
    reported = true;
    stream.push({ type: 'compaction', ...progress });
  });
  if (Array.isArray(result)) {
    return result;
  }
  if (result.summary && !reported) {
    stream.push({ type: 'compaction', summary: result.summary });
  }
  return result.messages;
}
