/**
 * LLMAdapter - LLM统一适配层
 * 基于 provider registry 动态装配可用的模型供应商。
 */

import type {
  LLMProvider,
  LLMConfig,
  LLMRequest,
  LLMResponse,
  LLMMessage,
  ContentBlock,
  StreamCallback,
  LLMProviderConfig,
} from '@shared/types/llm';
import type { LlmProviderKind } from '@shared/types/settings';

const toContentBlocks = (
  messages: LLMMessage[],
): Array<{
  role: string;
  content: string | Array<{ type: string; text?: string; image_url?: { url: string } }>;
}> => messages.map((message) => {
  if (typeof message.content === 'string') {
    return { role: message.role, content: message.content };
  }

  const content = (message.content as ContentBlock[]).map((block) => {
    if (block.type === 'text') {
      return { type: 'text', text: block.text };
    }
    if (block.type === 'image' && block.source) {
      return {
        type: 'image_url',
        image_url: {
          url: `data:${block.source.media_type};base64,${block.source.data}`,
        },
      };
    }
    return { type: 'text', text: '' };
  });

  return { role: message.role, content };
});

class OpenRouterProvider implements LLMProvider {
  name: string;
  private apiKey = '';
  private baseUrl = 'https://openrouter.ai/api/v1';
  private models: string[] = [];

  constructor(name: string) {
    this.name = name;
  }

  configure(config: LLMProviderConfig): void {
    this.apiKey = config.apiKey.trim();
    this.baseUrl = (config.baseUrl || 'https://openrouter.ai/api/v1').trim();
    this.models = config.models;
  }

  async chat(request: LLMRequest): Promise<LLMResponse> {
    const model = request.model || this.models[0] || 'anthropic/claude-3-opus';
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://rdcagent.local',
        'X-Title': 'RdcAgent',
      },
      signal: request.signal,
      body: JSON.stringify({
        model,
        messages: toContentBlocks(request.messages),
        max_tokens: request.maxTokens || 4096,
        temperature: request.temperature ?? 0.7,
        tools: request.tools,
        stream: false,
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenRouter API error: ${response.status} - ${await response.text()}`);
    }

    const data = await response.json();
    const choice = data.choices?.[0];

    return {
      id: data.id || `or-${Date.now()}`,
      model: data.model || model,
      content: choice?.message?.content || '',
      toolCalls: choice?.message?.tool_calls as LLMResponse['toolCalls'],
      usage: {
        inputTokens: data.usage?.prompt_tokens || 0,
        outputTokens: data.usage?.completion_tokens || 0,
      },
      stopReason: choice?.finish_reason === 'tool_calls' ? 'tool_use' : 'end_turn',
    };
  }

  async streamChat(request: LLMRequest, onChunk: StreamCallback): Promise<LLMResponse> {
    const response = await this.chat(request);
    onChunk(typeof response.content === 'string' ? response.content : JSON.stringify(response.content));
    return response;
  }

  async isAvailable(): Promise<boolean> {
    return Boolean(this.apiKey);
  }

  getModels(): string[] {
    return this.models;
  }
}

class OpenAICompatibleProvider implements LLMProvider {
  name: string;
  private apiKey = '';
  private baseUrl = 'https://api.openai.com/v1';
  private models: string[] = [];
  private requireApiKey = true;

  constructor(name: string, requireApiKey = true) {
    this.name = name;
    this.requireApiKey = requireApiKey;
  }

  configure(config: LLMProviderConfig): void {
    this.apiKey = config.apiKey.trim();
    this.baseUrl = (config.baseUrl || this.baseUrl).trim();
    this.models = config.models;
  }

  async chat(request: LLMRequest): Promise<LLMResponse> {
    const model = request.model || this.models[0] || 'gpt-4o';
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      signal: request.signal,
      body: JSON.stringify({
        model,
        messages: request.messages,
        max_tokens: request.maxTokens || 4096,
        temperature: request.temperature ?? 0.7,
      }),
    });

    if (!response.ok) {
      throw new Error(`${this.name} API error: ${response.status} - ${await response.text()}`);
    }

    const data = await response.json();
    const choice = data.choices?.[0];

    return {
      id: data.id || `${this.name}-${Date.now()}`,
      model: data.model || model,
      content: choice?.message?.content || '',
      toolCalls: choice?.message?.tool_calls as LLMResponse['toolCalls'],
      usage: {
        inputTokens: data.usage?.prompt_tokens || 0,
        outputTokens: data.usage?.completion_tokens || 0,
      },
      stopReason: choice?.finish_reason === 'tool_calls'
        ? 'tool_use'
        : choice?.finish_reason === 'stop'
          ? 'end_turn'
          : 'max_tokens',
    };
  }

  async streamChat(request: LLMRequest, onChunk: StreamCallback): Promise<LLMResponse> {
    const response = await this.chat(request);
    onChunk(typeof response.content === 'string' ? response.content : JSON.stringify(response.content));
    return response;
  }

  async isAvailable(): Promise<boolean> {
    return this.requireApiKey ? Boolean(this.apiKey) : true;
  }

  getModels(): string[] {
    return this.models;
  }
}

class AnthropicProvider implements LLMProvider {
  name: string;
  private apiKey = '';
  private baseUrl = 'https://api.anthropic.com/v1';
  private models: string[] = [];

  constructor(name: string) {
    this.name = name;
  }

  configure(config: LLMProviderConfig): void {
    this.apiKey = config.apiKey.trim();
    this.baseUrl = (config.baseUrl || 'https://api.anthropic.com/v1').trim();
    this.models = config.models;
  }

  async chat(request: LLMRequest): Promise<LLMResponse> {
    const model = request.model || this.models[0] || 'claude-3-7-sonnet-latest';
    const systemMessage = request.messages.find((message) => message.role === 'system');
    const otherMessages = request.messages.filter((message) => message.role !== 'system');

    const response = await fetch(`${this.baseUrl}/messages`, {
      method: 'POST',
      headers: {
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      signal: request.signal,
      body: JSON.stringify({
        model,
        max_tokens: request.maxTokens || 4096,
        system: typeof systemMessage?.content === 'string' ? systemMessage.content : undefined,
        messages: otherMessages.map((message) => ({
          role: message.role === 'assistant' ? 'assistant' : 'user',
          content: message.content,
        })),
      }),
    });

    if (!response.ok) {
      throw new Error(`Anthropic API error: ${response.status} - ${await response.text()}`);
    }

    const data = await response.json();

    return {
      id: data.id || `anthropic-${Date.now()}`,
      model: data.model || model,
      content: data.content?.[0]?.text || '',
      usage: {
        inputTokens: data.usage?.input_tokens || 0,
        outputTokens: data.usage?.output_tokens || 0,
      },
      stopReason: data.stop_reason === 'end_turn' ? 'end_turn' : 'max_tokens',
    };
  }

  async streamChat(request: LLMRequest, onChunk: StreamCallback): Promise<LLMResponse> {
    const response = await this.chat(request);
    onChunk(typeof response.content === 'string' ? response.content : JSON.stringify(response.content));
    return response;
  }

  async isAvailable(): Promise<boolean> {
    return Boolean(this.apiKey);
  }

  getModels(): string[] {
    return this.models;
  }
}

interface RuntimeProviderEntry {
  config: LLMProviderConfig;
  provider: LLMProvider;
}

const createProviderByKind = (providerId: string, kind: LlmProviderKind): LLMProvider => {
  if (kind === 'openrouter') {
    return new OpenRouterProvider(providerId);
  }
  if (kind === 'anthropic') {
    return new AnthropicProvider(providerId);
  }
  if (kind === 'ollama') {
    return new OpenAICompatibleProvider(providerId, false);
  }
  return new OpenAICompatibleProvider(providerId, true);
};

export class LLMAdapter {
  private providers = new Map<string, RuntimeProviderEntry>();
  private fallbackProviderId: string | null = null;

  configure(config: LLMConfig): void {
    this.providers.clear();
    this.fallbackProviderId = null;

    for (const providerConfig of config.providers) {
      const provider = createProviderByKind(providerConfig.id, providerConfig.kind);
      if ('configure' in provider && typeof (provider as { configure?: (config: LLMProviderConfig) => void }).configure === 'function') {
        (provider as { configure: (config: LLMProviderConfig) => void }).configure(providerConfig);
      }

      this.providers.set(providerConfig.id, {
        config: providerConfig,
        provider,
      });

      if (!this.fallbackProviderId && providerConfig.enabled) {
        this.fallbackProviderId = providerConfig.id;
      }
    }
  }

  async chat(request: LLMRequest, providerId?: string): Promise<LLMResponse> {
    const resolvedProviderId = providerId || this.fallbackProviderId;
    if (!resolvedProviderId) {
      throw new Error('No LLM provider configured');
    }

    const runtimeProvider = this.providers.get(resolvedProviderId);
    if (!runtimeProvider) {
      throw new Error(`Provider not found: ${resolvedProviderId}`);
    }

    if (!runtimeProvider.config.enabled) {
      throw new Error(`Provider disabled: ${resolvedProviderId}`);
    }

    if (!(await runtimeProvider.provider.isAvailable())) {
      throw new Error(`Provider not configured: ${resolvedProviderId}`);
    }

    return runtimeProvider.provider.chat(request);
  }

  async streamChat(request: LLMRequest, onChunk: StreamCallback, providerId?: string): Promise<LLMResponse> {
    const resolvedProviderId = providerId || this.fallbackProviderId;
    if (!resolvedProviderId) {
      throw new Error('No LLM provider configured');
    }

    const runtimeProvider = this.providers.get(resolvedProviderId);
    if (!runtimeProvider) {
      throw new Error(`Provider not found: ${resolvedProviderId}`);
    }

    return runtimeProvider.provider.streamChat(request, onChunk);
  }

  async testConnection(providerId: string): Promise<{ success: boolean; error?: string }> {
    const runtimeProvider = this.providers.get(providerId);
    if (!runtimeProvider) {
      return { success: false, error: `Provider not found: ${providerId}` };
    }

    try {
      const available = await runtimeProvider.provider.isAvailable();
      return { success: available, error: available ? undefined : 'Provider not configured' };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  getAvailableModels(providerId: string): string[] {
    return this.providers.get(providerId)?.config.models || [];
  }

  getDefaultProvider(): string {
    return this.fallbackProviderId || 'openrouter';
  }
}

export const llmAdapter = new LLMAdapter();
