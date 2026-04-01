/**
 * LMAdapter - LLM统一适配层
 * 支持多个LLM服务商：OpenRouter（必须）、OpenAI、Anthropic、Gemini、Kimi、xAI等
 */

import type {
  LLMProvider,
  LLMConfig,
  LLMRequest,
  LLMResponse,
  LLMMessage,
  ContentBlock,
  StreamCallback,
} from '@shared/types/llm';

/**
 * OpenRouter Provider - 必须支持
 */
class OpenRouterProvider implements LLMProvider {
  name = 'openrouter';
  private apiKey: string = '';
  private baseUrl = 'https://openrouter.ai/api/v1';

  configure(config: { apiKey: string; baseUrl?: string }): void {
    this.apiKey = config.apiKey;
    if (config.baseUrl) {
      this.baseUrl = config.baseUrl;
    }
  }

  async chat(request: LLMRequest): Promise<LLMResponse> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://rdcagent.local',
        'X-Title': 'RdcAgent',
      },
      body: JSON.stringify({
        model: request.model || 'anthropic/claude-3-opus',
        messages: this.normalizeMessages(request.messages),
        max_tokens: request.maxTokens || 4096,
        temperature: request.temperature ?? 0.7,
        tools: request.tools,
        stream: false,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenRouter API error: ${response.status} - ${error}`);
    }

    const data = await response.json();
    return this.normalizeResponse(data, request.model || 'anthropic/claude-3-opus');
  }

  async streamChat(
    request: LLMRequest,
    onChunk: StreamCallback
  ): Promise<LLMResponse> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://rdcagent.local',
        'X-Title': 'RdcAgent',
      },
      body: JSON.stringify({
        model: request.model || 'anthropic/claude-3-opus',
        messages: this.normalizeMessages(request.messages),
        max_tokens: request.maxTokens || 4096,
        temperature: request.temperature ?? 0.7,
        stream: true,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenRouter API error: ${response.status} - ${error}`);
    }

    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    let fullContent = '';

    while (reader) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value);
      const lines = chunk.split('\n').filter(line => line.startsWith('data:'));

      for (const line of lines) {
        const data = line.slice(5).trim();
        if (data === '[DONE]') continue;

        try {
          const parsed = JSON.parse(data);
          const content = parsed.choices?.[0]?.delta?.content || '';
          if (content) {
            fullContent += content;
            onChunk(content);
          }
        } catch {
          // 忽略解析错误
        }
      }
    }

    return {
      id: `or-${Date.now()}`,
      model: request.model || 'anthropic/claude-3-opus',
      content: fullContent,
      usage: { inputTokens: 0, outputTokens: 0 },
      stopReason: 'end_turn',
    };
  }

  async isAvailable(): Promise<boolean> {
    return !!this.apiKey;
  }

  getModels(): string[] {
    return [
      'anthropic/claude-3-opus',
      'anthropic/claude-3-sonnet',
      'anthropic/claude-3-haiku',
      'openai/gpt-4o',
      'openai/gpt-4-turbo',
      'openai/gpt-3.5-turbo',
      'google/gemini-pro-1.5',
      'google/gemini-flash-1.5',
      'x-ai/grok-beta',
      'moonshot/kimi-latest',
      'meta-llama/llama-3-70b-instruct',
    ];
  }

  private normalizeMessages(messages: LLMMessage[]): Array<{
    role: string;
    content: string | Array<{ type: string; text?: string; image_url?: { url: string } }>;
  }> {
    return messages.map(msg => {
      if (typeof msg.content === 'string') {
        return { role: msg.role, content: msg.content };
      }

      // 处理多模态内容
      const content = (msg.content as ContentBlock[]).map(block => {
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

      return { role: msg.role, content };
    });
  }

  private normalizeResponse(data: {
    id: string;
    model: string;
    choices: Array<{
      message: { content: string; tool_calls?: unknown[] };
      finish_reason: string;
    }>;
    usage?: { prompt_tokens: number; completion_tokens: number };
  }, model: string): LLMResponse {
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
}

/**
 * OpenAI Provider
 */
class OpenAIProvider implements LLMProvider {
  name = 'openai';
  private apiKey: string = '';
  private baseUrl = 'https://api.openai.com/v1';

  configure(config: { apiKey: string; baseUrl?: string }): void {
    this.apiKey = config.apiKey;
    if (config.baseUrl) {
      this.baseUrl = config.baseUrl;
    }
  }

  async chat(request: LLMRequest): Promise<LLMResponse> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: request.model || 'gpt-4o',
        messages: request.messages,
        max_tokens: request.maxTokens || 4096,
        temperature: request.temperature ?? 0.7,
      }),
    });

    const data = await response.json();
    const choice = data.choices?.[0];

    return {
      id: data.id,
      model: data.model,
      content: choice?.message?.content || '',
      usage: {
        inputTokens: data.usage?.prompt_tokens || 0,
        outputTokens: data.usage?.completion_tokens || 0,
      },
      stopReason: choice?.finish_reason === 'stop' ? 'end_turn' : 'max_tokens',
    };
  }

  async streamChat(request: LLMRequest, onChunk: StreamCallback): Promise<LLMResponse> {
    // 简化实现，复用chat
    const result = await this.chat(request);
    onChunk(result.content as string);
    return result;
  }

  async isAvailable(): Promise<boolean> {
    return !!this.apiKey;
  }

  getModels(): string[] {
    return ['gpt-4o', 'gpt-4-turbo', 'gpt-3.5-turbo'];
  }
}

/**
 * Anthropic Provider
 */
class AnthropicProvider implements LLMProvider {
  name = 'anthropic';
  private apiKey: string = '';
  private baseUrl = 'https://api.anthropic.com/v1';

  configure(config: { apiKey: string; baseUrl?: string }): void {
    this.apiKey = config.apiKey;
    if (config.baseUrl) {
      this.baseUrl = config.baseUrl;
    }
  }

  async chat(request: LLMRequest): Promise<LLMResponse> {
    const systemMessage = request.messages.find(m => m.role === 'system');
    const otherMessages = request.messages.filter(m => m.role !== 'system');

    const response = await fetch(`${this.baseUrl}/messages`, {
      method: 'POST',
      headers: {
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: request.model || 'claude-3-opus-20240229',
        max_tokens: request.maxTokens || 4096,
        system: systemMessage?.content,
        messages: otherMessages.map(m => ({
          role: m.role === 'assistant' ? 'assistant' : 'user',
          content: m.content,
        })),
      }),
    });

    const data = await response.json();

    return {
      id: data.id,
      model: data.model,
      content: data.content?.[0]?.text || '',
      usage: {
        inputTokens: data.usage?.input_tokens || 0,
        outputTokens: data.usage?.output_tokens || 0,
      },
      stopReason: data.stop_reason === 'end_turn' ? 'end_turn' : 'max_tokens',
    };
  }

  async streamChat(request: LLMRequest, onChunk: StreamCallback): Promise<LLMResponse> {
    const result = await this.chat(request);
    onChunk(result.content as string);
    return result;
  }

  async isAvailable(): Promise<boolean> {
    return !!this.apiKey;
  }

  getModels(): string[] {
    return ['claude-3-opus-20240229', 'claude-3-sonnet-20240229', 'claude-3-haiku-20240307'];
  }
}

/**
 * LLM Adapter - 统一入口
 */
export class LLMAdapter {
  private providers: Map<string, LLMProvider> = new Map();
  private defaultProvider: string = 'openrouter';

  constructor() {
    // 注册默认providers
    this.providers.set('openrouter', new OpenRouterProvider());
    this.providers.set('openai', new OpenAIProvider());
    this.providers.set('anthropic', new AnthropicProvider());
  }

  /**
   * 配置LLM
   */
  configure(config: LLMConfig): void {
    this.defaultProvider = config.defaultProvider || 'openrouter';

    // 配置各provider
    if (config.openrouter) {
      (this.providers.get('openrouter') as OpenRouterProvider)?.configure(config.openrouter);
    }
    if (config.openai) {
      (this.providers.get('openai') as OpenAIProvider)?.configure(config.openai);
    }
    if (config.anthropic) {
      (this.providers.get('anthropic') as AnthropicProvider)?.configure(config.anthropic);
    }
  }

  /**
   * 发送聊天请求
   */
  async chat(request: LLMRequest, provider?: string): Promise<LLMResponse> {
    const providerName = provider || this.defaultProvider;
    const p = this.providers.get(providerName);

    if (!p) {
      throw new Error(`Provider not found: ${providerName}`);
    }

    if (!(await p.isAvailable())) {
      throw new Error(`Provider not configured: ${providerName}`);
    }

    return p.chat(request);
  }

  /**
   * 流式聊天
   */
  async streamChat(
    request: LLMRequest,
    onChunk: StreamCallback,
    provider?: string
  ): Promise<LLMResponse> {
    const providerName = provider || this.defaultProvider;
    const p = this.providers.get(providerName);

    if (!p) {
      throw new Error(`Provider not found: ${providerName}`);
    }

    return p.streamChat(request, onChunk);
  }

  /**
   * 测试连接
   */
  async testConnection(provider: string): Promise<{ success: boolean; error?: string }> {
    const p = this.providers.get(provider);
    if (!p) {
      return { success: false, error: `Provider not found: ${provider}` };
    }

    try {
      const available = await p.isAvailable();
      return { success: available, error: available ? undefined : 'Provider not configured' };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * 获取可用模型列表
   */
  getAvailableModels(provider: string): string[] {
    const p = this.providers.get(provider);
    return p?.getModels() || [];
  }

  /**
   * 获取默认provider
   */
  getDefaultProvider(): string {
    return this.defaultProvider;
  }
}

// 单例导出
export const llmAdapter = new LLMAdapter();
