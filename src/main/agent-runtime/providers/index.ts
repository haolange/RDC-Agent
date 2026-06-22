/**
 * Agent Runtime Provider layer exports.
 *
 * Only consumed inside `src/main/agent-runtime/**`; renderer must not import this module directly.
 */

export { OpenAICompatibleProvider } from './OpenAICompatibleProvider';
export type { OpenAICompatibleProviderOptions } from './OpenAICompatibleProvider';
export { OpenAIResponsesProvider } from './OpenAIResponsesProvider';
export type { OpenAIResponsesProviderOptions } from './OpenAIResponsesProvider';
export { AnthropicProvider } from './AnthropicProvider';
export type { AnthropicProviderOptions } from './AnthropicProvider';
export { GeminiProvider } from './GeminiProvider';
export type { GeminiProviderOptions } from './GeminiProvider';
export { OllamaProvider } from './OllamaProvider';
export type { OllamaProviderOptions } from './OllamaProvider';
export * from './ProviderAuth';

import { ProviderRegistry } from '../core/ProviderRegistry';
import { OpenAICompatibleProvider } from './OpenAICompatibleProvider';
import { OpenAIResponsesProvider } from './OpenAIResponsesProvider';
import { AnthropicProvider } from './AnthropicProvider';
import { GeminiProvider } from './GeminiProvider';
import { OllamaProvider } from './OllamaProvider';

/**
 * Register builtin provider strategies with default configuration.
 * Credentials and base URLs are injected at stream time through StreamOptions.
 */
export function registerBuiltinProviders(registry: ProviderRegistry): void {
  registry.register(new OpenAICompatibleProvider());
  registry.register(new OpenAIResponsesProvider());
  registry.register(new AnthropicProvider());
  registry.register(new GeminiProvider());
  registry.register(new OllamaProvider());
}