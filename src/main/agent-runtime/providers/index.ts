/**
 * Agent Runtime Provider 层统一导出。
 *
 * 仅在 `src/main/agent-runtime/**` 内部消费，不要在 renderer 直接 import。
 */

export { OpenAICompatibleProvider } from './OpenAICompatibleProvider';
export type { OpenAICompatibleProviderOptions } from './OpenAICompatibleProvider';
export { AnthropicProvider } from './AnthropicProvider';
export type { AnthropicProviderOptions } from './AnthropicProvider';
export { GeminiProvider } from './GeminiProvider';
export type { GeminiProviderOptions } from './GeminiProvider';
export { OllamaProvider } from './OllamaProvider';
export type { OllamaProviderOptions } from './OllamaProvider';
export * from './ProviderAuth';

import { ProviderRegistry } from '../core/ProviderRegistry';
import { OpenAICompatibleProvider } from './OpenAICompatibleProvider';
import { AnthropicProvider } from './AnthropicProvider';
import { GeminiProvider } from './GeminiProvider';
import { OllamaProvider } from './OllamaProvider';

/**
 * 注册所有内置 Provider 到给定的 ProviderRegistry。
 *
 * 每个 Provider 都使用默认配置注册：
 * - 实际的凭证 / baseUrl 在 `stream(model, ctx, options)` 调用时通过 `StreamOptions` 注入。
 * - 上层若要预绑定凭证，可自行实例化 Provider 后调用 `registry.register(...)`。
 */
export function registerBuiltinProviders(registry: ProviderRegistry): void {
  registry.register(new OpenAICompatibleProvider());
  registry.register(new AnthropicProvider());
  registry.register(new GeminiProvider());
  registry.register(new OllamaProvider());
}
