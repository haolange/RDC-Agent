/**
 * ProviderRegistry — Strategy + Registry 模式的 LLM Provider 路由层。
 *
 * 设计目标：
 * - 隔离 Agent Runtime 调用方与具体 Provider 实现，所有上层只依赖 `Model.api`。
 * - 每个 Provider 实现 `ProviderStrategy` 接口，可独立测试 / 替换。
 * - Registry 负责按 `model.api` 自动路由，并暴露统一的 `stream()` 入口。
 */

import type { EventStream } from './EventStream';
import type {
  AssistantMessage,
  AssistantMessageEvent,
  Context,
  Model,
  ProviderCapabilities,
  StreamOptions,
} from './types';

/**
 * LLM Provider 策略接口。
 *
 * 每个 Provider 实现此接口以提供统一的 stream 能力。
 * 实现方负责：网络调用、SSE 解析、错误归一化、`AbortSignal` 透传。
 */
export interface ProviderStrategy {
  /** Provider 适配的 API 协议族标识，与 `Model.api` 对应。 */
  readonly api: string;

  /**
   * 流式调用 LLM，返回事件流。
   *
   * 调用方可以：
   * - `for await` 消费 `AssistantMessageEvent`；
   * - `await stream.result()` 获取最终 `AssistantMessage`；
   * - `stream.abort()` 主动中止。
   */
  stream(
    model: Model,
    context: Context,
    options?: StreamOptions,
  ): EventStream<AssistantMessageEvent, AssistantMessage>;

  /** 获取 Provider 能力矩阵。 */
  getCapabilities(): ProviderCapabilities;
}

/**
 * Provider 注册中心。
 *
 * 按 `model.api` 路由到具体 Provider 实现。
 * 同一个 `api` 后注册的 strategy 会覆盖前一次注册，便于测试时替换。
 */
export class ProviderRegistry {
  private readonly providers = new Map<string, ProviderStrategy>();

  /** 注册一个 Provider 策略。 */
  register(strategy: ProviderStrategy): void {
    if (!strategy || typeof strategy.api !== 'string' || !strategy.api) {
      throw new Error('ProviderRegistry.register requires a strategy with non-empty api');
    }
    this.providers.set(strategy.api, strategy);
  }

  /** 注销 Provider 策略；不存在时静默返回。 */
  unregister(api: string): void {
    this.providers.delete(api);
  }

  /** 根据 api 标识获取 Provider；未注册时返回 undefined。 */
  getStrategy(api: string): ProviderStrategy | undefined {
    return this.providers.get(api);
  }

  /** 列出所有已注册的 api 标识。 */
  listProviders(): string[] {
    return Array.from(this.providers.keys());
  }

  /**
   * 根据 `model.api` 自动路由并调用 stream。
   *
   * 未找到对应 Provider 时会抛出错误，避免静默 fallback。
   */
  stream(
    model: Model,
    context: Context,
    options?: StreamOptions,
  ): EventStream<AssistantMessageEvent, AssistantMessage> {
    const strategy = this.providers.get(model.api);
    if (!strategy) {
      throw new Error(
        `ProviderRegistry: no provider registered for api "${model.api}" (model "${model.id}")`,
      );
    }
    return strategy.stream(model, context, options);
  }
}
