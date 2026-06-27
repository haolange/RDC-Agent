/**
 * AgentLoop — transition 状态机式 Agent 主循环。
 *
 * 设计对标 Claude Code `query.ts`：用显式 `LoopState` + 「State 重写 + continue」
 * 表达所有恢复/继续路径，单层 `while(true)` 直线流水线，线性可读可断言。
 *
 * transition 站点（每轮顶部快照 state，按 reason 分发）：
 * - `init`          注入初始 pending（用户消息），进入首轮。
 * - `next_turn`     正常工具循环：调 LLM → 执行工具 → 若有 toolUse 继续。
 * - `steering`      工具执行后 steering 命中：把 steering 消息作下一轮 pending。
 * - `follow_up`     内层停止后检查 followUp 队列：有则作下一轮 pending。
 * - `terminal`      终止（max_turns / 无 toolUse 且无 followUp / abort）。
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
import { ErrorRecovery } from './ErrorRecovery';

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
  ) => Promise<AgentMessage[]>;
  /** LLM 调用选项（temperature/maxTokens 等）。 */
  streamOptions?: StreamOptions;
  /** 获取动态 API Key（支持 OAuth token 刷新）。 */
  getApiKey?: (provider: string) => Promise<string | undefined>;
  /** 最大工具执行轮数（防止无限循环）。 */
  maxTurns?: number;
  /** 工具并行执行的最大并发数。1 = 顺序（默认），0 或 >1 = 并发。 */
  maxToolConcurrency?: number;
  /**
   * 在每个工具执行结束后调用，返回当前 steering 队列中的消息（出队）。
   * 返回空数组表示当前没有 steering，循环继续。
   */
  getSteeringMessages?: () => UserMessage[];
  /**
   * 在内层循环停止后调用，返回 followUp 队列中的消息（出队）。
   * 返回空数组表示外层循环可以结束。
   */
  getFollowUpMessages?: () => UserMessage[];
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
  cronScheduler?: { getPendingPrompts(): string[] };
  /** 错误恢复管理器（可选）。集成后 LLM 错误会触发自动重试/模型切换/压缩。 */
  errorRecovery?: ErrorRecovery;
}

/** Agent 上下文（可变；agentLoop 会原地修改 messages）。 */
export interface AgentContext {
  systemPrompt?: string;
  messages: AgentMessage[];
  tools?: ToolDefinition[];
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
  steeringMessages?: UserMessage[];
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
): EventStream<AgentEvent, Message[]> {
  const stream = new EventStream<AgentEvent, Message[]>();
  void runAgentLoop(
    [...pendingMessages],
    context,
    config,
    providerStrategy,
    toolExecutor,
    stream,
  );
  return stream;
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
): EventStream<AgentEvent, Message[]> {
  return agentLoop([], context, config, providerStrategy, toolExecutor);
}

// =====================================================================
// 主循环实现
// =====================================================================

/** transition reason：标记「本轮为何继续」，便于测试断言走了哪条路径。 */
type TransitionReason = 'init' | 'next_turn' | 'steering' | 'follow_up';

/** 显式循环状态。每轮顶部快照，恢复/继续路径用「重写 state + continue」表达。 */
interface LoopState {
  /** 待注入上下文的 pending 消息（用户/steering/followUp）。 */
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
    if (config.cronScheduler) {
      for (const prompt of config.cronScheduler.getPendingPrompts()) {
        injected.push({
          role: 'user',
          content: [{ type: 'text', text: `<cron_triggered>${prompt}</cron_triggered>` }],
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
      // 2. 注入 pending（init / steering / follow_up 站点携带 pending）
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
        break;
      }
      stream.push({ type: 'turn_start', turn: state.turn });

      // 5. 注入 scheduled（background/cron）
      injectScheduled();

      // 6. 调用 LLM 生成助手消息（带错误恢复，内部是独立 transition 子状态机）
      const { message: assistantMessage } = await streamAssistantResponseWithRecovery(
        context,
        config,
        providerStrategy,
        stream,
      );
      newMessages.push(assistantMessage);

      // 7. 非 toolUse 停止 → 检查 followUp，决定 follow_up 还是 terminal
      if (assistantMessage.stopReason !== 'toolUse') {
        stream.push({ type: 'turn_end', turn: state.turn, message: assistantMessage });
        const followUps = config.getFollowUpMessages ? config.getFollowUpMessages() : [];
        if (followUps && followUps.length > 0) {
          // follow_up 站点：重写 state，携带 followUp 作为下一轮 pending
          state = { pending: followUps, turn: state.turn, transition: 'follow_up' };
          continue;
        }
        // terminal：无 toolUse 且无 followUp
        break;
      }

      // 8. 执行工具调用
      const toolResults = await executeToolCalls(
        assistantMessage,
        toolExecutor,
        stream,
        config.getSteeringMessages,
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

      // 9. steering 命中 → steering 站点：重写 state，携带 steering 消息作下一轮 pending
      if (toolResults.steeringMessages && toolResults.steeringMessages.length > 0) {
        state = {
          pending: toolResults.steeringMessages,
          turn: state.turn,
          transition: 'steering',
        };
        continue;
      }

      // 10. next_turn 站点：正常工具循环继续
      state = { pending: [], turn: state.turn, transition: 'next_turn' };
    }

    stream.push({ type: 'agent_end', messages: newMessages });
    stream.complete(newMessages);
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    if (!stream.isDone) {
      stream.push({ type: 'error', error });
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
): Promise<{ message: AssistantMessage }> {
  const recovery = config.errorRecovery;
  const CIRCUIT_BREAKER_LIMIT = 3;
  let consecutiveCompactionFailures = 0;

  while (true) {
    try {
      const assistantMessage = await streamAssistantResponse(
        context,
        config,
        provider,
        stream,
      );
      // 成功时重置断路器
      consecutiveCompactionFailures = 0;

      // stopReason === 'length'：输出被 max_tokens 截断，走恢复策略
      // （escalate_tokens 提额 / continue_prompt 续写 / abort）。
      if (recovery && assistantMessage.stopReason === 'length') {
        const lengthAction = recovery.decide(null, 'length');
        switch (lengthAction.type) {
          case 'escalate_tokens': {
            recovery.markEscalated();
            if (config.streamOptions) {
              config.streamOptions.maxTokens = lengthAction.newMaxTokens;
            }
            continue;
          }
          case 'continue_prompt': {
            recovery.noteRetryAttempt();
            // 续写：注入一条 user nudge 让模型继续未完成的输出。
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
            // retry/reactive_compact/switch_model 不适用于 length，直接返回。
            return { message: assistantMessage };
          }
        }
      }

      return { message: assistantMessage };
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));

      if (!recovery) {
        throw error;
      }

      const action = recovery.decide(error);

      switch (action.type) {
        case 'retry': {
          recovery.noteRetryAttempt();
          await sleep(action.delayMs);
          continue;
        }
        case 'escalate_tokens': {
          recovery.markEscalated();
          if (config.streamOptions) {
            config.streamOptions.maxTokens = action.newMaxTokens;
          }
          continue;
        }
        case 'reactive_compact': {
          consecutiveCompactionFailures++;
          if (consecutiveCompactionFailures >= CIRCUIT_BREAKER_LIMIT) {
            throw new Error(
              `[Circuit breaker] ${CIRCUIT_BREAKER_LIMIT} consecutive compaction attempts failed; aborting`,
            );
          }
          recovery.markReactiveCompactAttempted();
          if (config.transformContext) {
            context.messages = await config.transformContext(
              context.messages,
              stream.signal,
            );
          }
          continue;
        }
        case 'switch_model': {
          config.model = action.fallbackModel;
          continue;
        }
        case 'continue_prompt': {
          recovery.noteRetryAttempt();
          continue;
        }
        case 'abort': {
          throw new Error(`[Recovery abort] ${action.reason}`);
        }
      }
    }
  }
}

/** 简单的异步延时。 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
): Promise<AssistantMessage> {
  // 1. 可选的上下文变换（压缩 / 剪裁）
  let messages: AgentMessage[] = context.messages;
  if (config.transformContext) {
    messages = await config.transformContext(
      [...context.messages],
      stream.signal,
    );
  }

  // 2. 转换为 LLM Message[]
  const llmMessages = config.convertToLlm(messages);

  // 3. 构建 LLM Context
  const llmContext: Context = {
    systemPrompt: context.systemPrompt,
    messages: llmMessages,
    tools: context.tools,
  };

  // 4. 解析 API key（优先动态获取）
  const dynamicKey = config.getApiKey
    ? await config.getApiKey(config.model.provider)
    : undefined;
  const apiKey = dynamicKey ?? config.streamOptions?.apiKey;

  // 5. 合并 stream options，传入 abort 信号
  const streamOptions: StreamOptions = {
    ...(config.streamOptions ?? {}),
    apiKey,
    signal: stream.signal,
  };

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

  return finalMessage;
}

// =====================================================================
// 工具执行
// =====================================================================

/**
 * 执行助手消息中的工具调用（支持并发），并在每次工具执行结束后检查 steering。
 */
async function executeToolCalls(
  assistantMessage: AssistantMessage,
  toolExecutor: ToolExecutor | undefined,
  stream: EventStream<AgentEvent, Message[]>,
  getSteeringMessages?: () => UserMessage[],
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

    // 检查 steering（仅第一个完成的工具检查，避免重复）
    if (getSteeringMessages && index === 0) {
      const steering = getSteeringMessages();
      if (steering && steering.length > 0) {
        // 标记剩余未完成的工具调用为 Skipped
        for (let j = 1; j < toolCalls.length; j++) {
          if (!results[j]) {
            const skipped: ToolResultMessage = {
              role: 'toolResult',
              toolCallId: toolCalls[j].id,
              toolName: toolCalls[j].name,
              content: [{ type: 'text', text: 'Skipped due to queued user message' }],
              isError: false,
              timestamp: Date.now(),
            };
            stream.push({
              type: 'tool_execution_end',
              toolCallId: toolCalls[j].id,
              toolName: toolCalls[j].name,
              result: skipped,
              durationMs: 0,
            });
            results[j] = skipped;
          }
        }
        throw { steeringMessages: steering };
      }
    }
  };

  // 并发执行
  for (let i = 0; i < toolCalls.length; i += concurrency) {
    const batch = [];
    for (let j = i; j < Math.min(i + concurrency, toolCalls.length); j++) {
      batch.push(executeOne(j));
    }
    try {
      await Promise.all(batch);
    } catch (err) {
      if (err && typeof err === 'object' && 'steeringMessages' in err) {
        const steeringResult = err as { steeringMessages: UserMessage[] };
        return {
          results: results.filter(Boolean) as ToolResultMessage[],
          steeringMessages: steeringResult.steeringMessages,
        };
      }
      throw err;
    }
  }

  return { results: results.filter(Boolean) as ToolResultMessage[] };
}
