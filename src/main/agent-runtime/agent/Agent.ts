/**
 * Agent — 高层 Agent 类（状态机 + 事件订阅）。
 *
 * 状态机：idle → streaming → idle
 *  - prompt(): 在 idle 状态发起一次新的 agent 循环。
 *  - abort(): 中止当前流。
 *  - subscribe(): 订阅所有 AgentEvent。
 *
 * 该类是对 `agentLoop()` 的封装，负责：
 *  - 管理 model / systemPrompt；tools 经 LoopRuntimeState 修订（COW）；
 *  - messages 为 turn-scoped 执行缓冲（rehydrate/clear；canonical history 在磁盘）；
 *  - 把 EventStream 事件多播给所有订阅者；
 *  - 协调 abort 信号。
 */

import { EventStream } from '../core/EventStream';
import { ErrorRecovery } from './ErrorRecovery';
import type {
  AgentEvent,
  AgentMessage,
  AssistantMessage,
  Message,
  Model,
  StreamOptions,
  TextContent,
  ImageContent,
  ToolDefinition,
  ToolResultMessage,
  UserMessage,
} from '../core/types';
import type { ProviderStrategy } from '../core/ProviderRegistry';
import {
  agentLoop,
  type AgentContext,
  type AgentLoopConfig,
  type AgentLoopHandle,
  type LoopRuntimeState,
  type ToolExecutor,
  type TransformContextResult,
} from './AgentLoop';

/** Agent 事件订阅者签名。 */
export type AgentEventSubscriber = (event: AgentEvent) => void;

export type { LoopRuntimeState };

/** Agent 当前持有的可变状态。 */
export interface AgentState {
  systemPrompt?: string;
  systemPromptSegments?: AgentContext['systemPromptSegments'];
  model: Model;
  tools?: ToolDefinition[];
  messages: AgentMessage[];
}

function createLoopRuntimeState(
  tools: ToolDefinition[] = [],
  activatedDeferredTools: ReadonlySet<string> = new Set(),
  revision = 1,
): LoopRuntimeState {
  return {
    revision,
    activeTools: [...tools],
    activatedDeferredTools: new Set(activatedDeferredTools),
  };
}

/** Agent 构造选项。 */
export interface AgentOptions {
  /** 初始状态：必须给定 model；messages/tools/systemPrompt 可选。 */
  initialState: Omit<AgentState, 'messages'> & { messages?: AgentMessage[] };
  /** LLM Provider 策略。 */
  provider: ProviderStrategy;
  /** 工具执行器；缺省时所有工具调用都会返回错误。 */
  toolExecutor?: ToolExecutor;
  /**
   * 自定义 AgentMessage → LLM Message 的转换函数。
   * 缺省实现：保留 user / assistant / toolResult 三种标准消息。
   */
  convertToLlm?: (messages: AgentMessage[]) => Message[];
  /** 可选的上下文变换（如压缩 / 剪裁）。 */
  transformContext?: (
    messages: AgentMessage[],
    signal?: AbortSignal,
  ) => Promise<TransformContextResult>;
  /** 动态 API key 获取（支持 OAuth token 刷新）。 */
  getApiKey?: (provider: string) => Promise<string | undefined>;
  /** Provider stream 调用选项。 */
  streamOptions: StreamOptions;
  /** Per-call output cap; computed immediately before each provider request. */
  resolveMaxTokens?: AgentLoopConfig['resolveMaxTokens'];
  /** 最大工具执行轮数（防御性上限）。 */
  maxTurns?: number;
  /** 错误恢复管理器（可选）。用于 LLM 错误的自动重试/模型切换/压缩。 */
  errorRecovery?: ErrorRecovery;
  onRequest?: AgentLoopConfig['onRequest'];
  onResponse?: AgentLoopConfig['onResponse'];
  beforeRequestMessages?: AgentLoopConfig['beforeRequestMessages'];
}

// =====================================================================
// 默认 convertToLlm
// =====================================================================

/**
 * 默认 convertToLlm：保留三种标准 role 的消息，
 * 其它 CustomAgentMessage 在送入 LLM 之前被丢弃。
 */
function defaultConvertToLlm(messages: AgentMessage[]): Message[] {
  const result: Message[] = [];
  for (const msg of messages) {
    if (msg.role === 'user' || msg.role === 'assistant' || msg.role === 'toolResult') {
      result.push(msg as Message);
    }
  }
  return result;
}

// =====================================================================
// Agent 实现
// =====================================================================

export class Agent {
  private _state: AgentState;
  private _runtime: LoopRuntimeState;
  /** Shared ref so AgentLoop re-reads tools each LLM round after COW revision bumps. */
  private readonly _runtimeRef: { current: LoopRuntimeState };
  private _isStreaming = false;
  private _subscribers: AgentEventSubscriber[] = [];
  private _currentStream: EventStream<AgentEvent, Message[]> | null = null;
  private _activeLoopPromise: Promise<Message[]> | null = null;
  private _activeProducerCompletion: Promise<void> | null = null;
  private readonly _provider: ProviderStrategy;
  private readonly _toolExecutor?: ToolExecutor;
  private readonly _options: AgentOptions;

  constructor(options: AgentOptions) {
    this._options = options;
    this._provider = options.provider;
    this._toolExecutor = options.toolExecutor;
    const initialTools = options.initialState.tools ? [...options.initialState.tools] : [];
    this._runtime = createLoopRuntimeState(initialTools);
    this._runtimeRef = { current: this._runtime };
    this._state = {
      systemPrompt: options.initialState.systemPrompt,
      systemPromptSegments: options.initialState.systemPromptSegments
        ? options.initialState.systemPromptSegments.map((segment) => ({ ...segment }))
        : undefined,
      model: options.initialState.model,
      tools: this._runtime.activeTools,
      messages: options.initialState.messages ? [...options.initialState.messages] : [],
    };
  }

  // -------------------------------------------------------------------
  // 状态查询
  // -------------------------------------------------------------------

  /** 当前是否正在流式处理。 */
  get isStreaming(): boolean {
    return this._isStreaming;
  }

  /**
   * 获取当前状态快照（浅拷贝；messages 数组本身不可变，但元素仍是引用）。
   */
  get state(): Readonly<AgentState> {
    return {
      systemPrompt: this._state.systemPrompt,
      systemPromptSegments: this._state.systemPromptSegments
        ? this._state.systemPromptSegments.map((segment) => ({ ...segment }))
        : undefined,
      model: this._state.model,
      tools: [...this._runtime.activeTools],
      messages: [...this._state.messages],
    };
  }

  /** 获取消息历史。 */
  get messages(): ReadonlyArray<AgentMessage> {
    return this._state.messages;
  }

  /** 当前 LoopRuntimeState 快照（COW revision）。 */
  get runtimeState(): Readonly<LoopRuntimeState> {
    return {
      revision: this._runtime.revision,
      activeTools: [...this._runtime.activeTools],
      activatedDeferredTools: new Set(this._runtime.activatedDeferredTools),
    };
  }

  // -------------------------------------------------------------------
  // 订阅
  // -------------------------------------------------------------------

  /**
   * 订阅事件。
   * @returns 解除订阅的函数。
   */
  subscribe(subscriber: AgentEventSubscriber): () => void {
    this._subscribers.push(subscriber);
    return () => {
      const idx = this._subscribers.indexOf(subscriber);
      if (idx >= 0) {
        this._subscribers.splice(idx, 1);
      }
    };
  }

  // -------------------------------------------------------------------
  // 主流程：prompt / abort
  // -------------------------------------------------------------------

  /**
   * 发送消息并启动 agent 循环。
   *
   * @param input  字符串或完整 UserMessage。
   * @returns      本次循环新增的所有消息（含 user/assistant/toolResult）。
   * @throws       已在 streaming 状态时抛出。
   */
  async prompt(input: string | UserMessage): Promise<Message[]> {
    if (this._isStreaming) {
      throw new Error('Agent.prompt: agent is already streaming');
    }

    const userMessage = normalizeUserMessage(input);
    const pending: UserMessage[] = [userMessage];

    const loopPromise = this.runLoop(pending);
    this._activeLoopPromise = loopPromise;
    try {
      return await loopPromise;
    } finally {
      if (this._activeLoopPromise === loopPromise) {
        this._activeLoopPromise = null;
      }
    }
  }

  /** 中止当前流；非 streaming 状态时是 no-op。 */
  /** Wait for the complete provider/tool loop after requesting cancellation. */
  async abortAndJoin(): Promise<void> {
    this.abort();
    const loopPromise = this._activeLoopPromise;
    const producerCompletion = this._activeProducerCompletion;
    await Promise.allSettled([
      loopPromise ?? Promise.resolve(),
      producerCompletion ?? Promise.resolve(),
    ]);
  }

  /** The current loop promise, when a provider/tool producer is still active. */
  get activeLoopPromise(): Promise<Message[]> | null {
    return this._activeLoopPromise;
  }

  abort(): void {
    if (this._currentStream && !this._currentStream.isDone) {
      this._currentStream.abort();
    }
  }

  // -------------------------------------------------------------------
  // 状态变更
  // -------------------------------------------------------------------

  /** 动态更新模型（不影响正在进行的请求；下一轮生效）。 */
  setModel(model: Model): void {
    this._state.model = model;
  }

  /**
   * 动态更新工具列表（COW）。
   *
   * 不再原地 splice 共享数组；bump revision，下一轮 LLM 调用经 runtime ref 读取新 activeTools。
   */
  setTools(tools: ToolDefinition[]): void {
    this._runtime = createLoopRuntimeState(
      tools,
      this._runtime.activatedDeferredTools,
      this._runtime.revision + 1,
    );
    this._runtimeRef.current = this._runtime;
    this._state.tools = this._runtime.activeTools;
  }

  /**
   * Deferred 激活：同步更新 activatedDeferredTools + activeTools，并 bump revision。
   */
  activateDeferredTools(activated: ReadonlySet<string>, activeTools: ToolDefinition[]): void {
    this._runtime = createLoopRuntimeState(
      activeTools,
      activated,
      this._runtime.revision + 1,
    );
    this._runtimeRef.current = this._runtime;
    this._state.tools = this._runtime.activeTools;
  }

  /** 动态更新系统提示。 */
  setSystemPrompt(prompt: string): void {
    this._state.systemPrompt = prompt;
  }

  /** 追加消息到历史（不触发循环）。 */
  appendMessage(message: AgentMessage): void {
    this._state.messages.push(message);
  }

  /**
   * Turn 开始：用磁盘权威 history 覆盖内存缓冲。
   * Agent 不跨 turn 持有 canonical history。
   */
  rehydrateMessages(messages: AgentMessage[]): void {
    this._state.messages = [...messages];
  }

  /** Turn 结束：清空内存 messages（持久化由 ConversationService 负责）。 */
  clearMessages(): void {
    this._state.messages = [];
  }

  // -------------------------------------------------------------------
  // 私有：循环执行
  // -------------------------------------------------------------------

  private async runLoop(pending: UserMessage[]): Promise<Message[]> {
    this._isStreaming = true;

    const context: AgentContext = {
      systemPrompt: this._state.systemPrompt,
      systemPromptSegments: this._state.systemPromptSegments,
      messages: this._state.messages,
      tools: this._runtime.activeTools,
      runtime: this._runtimeRef,
    };

    const config = this.createLoopConfig();
    const { stream, producerCompletion }: AgentLoopHandle = agentLoop(
      pending,
      context,
      config,
      this._provider,
      this._toolExecutor,
    );
    this._currentStream = stream;
    this._activeProducerCompletion = producerCompletion;

    try {
      // 多播事件（单一消费者读取，转发给所有订阅者）
      for await (const event of stream) {
        this.emit(event);
      }
      const result = await stream.result();
      return result;
    } finally {
      await producerCompletion.catch(() => undefined);
      if (this._activeProducerCompletion === producerCompletion) {
        this._activeProducerCompletion = null;
      }
      this._isStreaming = false;
      this._currentStream = null;
    }
  }

  private emit(event: AgentEvent): void {
    const subs = [...this._subscribers];
    for (const sub of subs) {
      try {
        sub(event);
      } catch {
        // 订阅者异常不应影响 agent 运行
      }
    }
  }

  private createLoopConfig(): AgentLoopConfig {
    const opts = this._options;
    return {
      model: this._state.model,
      convertToLlm: opts.convertToLlm ?? defaultConvertToLlm,
      transformContext: opts.transformContext,
      streamOptions: opts.streamOptions,
      resolveMaxTokens: opts.resolveMaxTokens,
      getApiKey: opts.getApiKey,
      maxTurns: opts.maxTurns,
      signal: opts.streamOptions.signal,
      errorRecovery: opts.errorRecovery,
      onRequest: opts.onRequest,
      onResponse: opts.onResponse,
      beforeRequestMessages: opts.beforeRequestMessages,
    };
  }
}

// =====================================================================
// 工具函数
// =====================================================================

/** 把字符串或 UserMessage 归一化为 UserMessage。 */
function normalizeUserMessage(input: string | UserMessage): UserMessage {
  if (typeof input === 'string') {
    return {
      role: 'user',
      content: input,
      timestamp: Date.now(),
    };
  }
  return input;
}

export type {
  AssistantMessage,
  Message,
  Model,
  ToolDefinition,
  ToolResultMessage,
  UserMessage,
  TextContent,
  ImageContent,
};
