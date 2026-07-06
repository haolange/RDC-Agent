/**
 * LLMAdapter - unified provider adapter with real streaming support.
 */

import type {
  ContentBlock,
  LLMConfig,
  LLMMessage,
  LLMProvider,
  LLMProviderConfig,
  LLMRequest,
  LLMResponse,
  StreamCallback,
  ToolCall,
} from '@shared/types/llm';
import { COPILOT_WIRE_HEADERS } from './CopilotWire';
import {
  applyGeminiReasoning,
  applyOpenAiCompatibleReasoning,
  applyReasoningToAnthropicLikeBody,
  buildOpenAiResponsesReasoning,
} from '../agent-runtime/providers/reasoningWire';

const describeUnsupportedProtocol = (providerId: string, protocol: unknown): string => {
  const value = typeof protocol === 'string' && protocol.trim() ? protocol.trim() : 'missing';
  return `Provider ${providerId} uses unsupported protocol "${value}".`;
};

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

const normalizeOpenRouterBaseUrl = (baseUrl: string): string => {
  const trimmed = (baseUrl || 'https://openrouter.ai/api/v1').trim().replace(/\/+$/, '');
  if (/^https:\/\/openrouter\.ai\/api$/i.test(trimmed)) {
    return `${trimmed}/v1`;
  }
  return trimmed;
};

const appendQueryParam = (url: string, key: string, value: string): string => {
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
};

const extractMessageContent = (
  payload: unknown,
): string | ContentBlock[] => {
  if (!payload || typeof payload !== 'object') {
    return '';
  }

  const message = (payload as { message?: Record<string, unknown> }).message ?? null;
  const messageContent = message?.content;
  if (typeof messageContent === 'string' && messageContent.trim()) {
    return messageContent;
  }
  if (Array.isArray(messageContent) && messageContent.length > 0) {
    return messageContent as ContentBlock[];
  }
  if (messageContent && typeof messageContent === 'object') {
    return JSON.stringify(messageContent);
  }

  const stringFallbacks = [
    message?.output_text,
    message?.reasoning_content,
    message?.reasoning,
    message?.refusal,
    (payload as { text?: unknown }).text,
    (payload as { output_text?: unknown }).output_text,
  ];

  for (const candidate of stringFallbacks) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate;
    }
  }

  return '';
};

const toResponsesInput = (messages: LLMMessage[]): Array<{ role: string; content: string }> =>
  messages.map((message) => ({
    role: message.role === 'assistant' || message.role === 'system' ? message.role : 'user',
    content: typeof message.content === 'string' ? message.content : JSON.stringify(message.content),
  }));

const toOpenAiTools = (tools?: LLMRequest['tools']) => {
  if (!tools?.length) {
    return undefined;
  }
  return tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.input_schema,
    },
  }));
};

const toResponsesTools = (tools?: LLMRequest['tools']) => {
  if (!tools?.length) {
    return undefined;
  }
  return tools.map((tool) => ({
    type: 'function',
    name: tool.name,
    description: tool.description,
    parameters: tool.input_schema,
  }));
};

const extractResponsesText = (payload: unknown): string => {
  if (!payload || typeof payload !== 'object') {
    return '';
  }
  const record = payload as Record<string, unknown>;
  if (typeof record.output_text === 'string') {
    return record.output_text;
  }

  const output = Array.isArray(record.output) ? record.output : [];
  const chunks: string[] = [];
  for (const item of output) {
    const itemRecord = item && typeof item === 'object' ? item as Record<string, unknown> : {};
    const content = Array.isArray(itemRecord.content) ? itemRecord.content : [];
    for (const block of content) {
      const blockRecord = block && typeof block === 'object' ? block as Record<string, unknown> : {};
      const text = typeof blockRecord.text === 'string'
        ? blockRecord.text
        : typeof blockRecord.output_text === 'string'
          ? blockRecord.output_text
          : '';
      if (text) {
        chunks.push(text);
      }
    }
  }
  if (chunks.length > 0) {
    return chunks.join('');
  }

  const fallback = extractMessageContent(payload);
  return typeof fallback === 'string' ? fallback : JSON.stringify(fallback);
};

const extractResponsesUsage = (payload: unknown): { inputTokens: number; outputTokens: number } => {
  const record = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
  const usage = record.usage && typeof record.usage === 'object' ? record.usage as Record<string, unknown> : {};
  const input = usage.input_tokens ?? usage.prompt_tokens;
  const output = usage.output_tokens ?? usage.completion_tokens;
  return {
    inputTokens: typeof input === 'number' ? input : 0,
    outputTokens: typeof output === 'number' ? output : 0,
  };
};

interface StreamingAccumulator {
  id: string;
  model: string;
  content: string;
  toolCalls: Array<{
    id: string;
    name: string;
    argumentsText: string;
  }>;
  inputTokens: number;
  outputTokens: number;
  stopReason: LLMResponse['stopReason'];
}

const createAccumulator = (model: string): StreamingAccumulator => ({
  id: `stream-${Date.now()}`,
  model,
  content: '',
  toolCalls: [],
  inputTokens: 0,
  outputTokens: 0,
  stopReason: 'end_turn',
});

const ensureToolCall = (
  toolCalls: StreamingAccumulator['toolCalls'],
  index: number,
  id?: string,
): StreamingAccumulator['toolCalls'][number] => {
  while (toolCalls.length <= index) {
    toolCalls.push({
      id: id || `tool-call-${index}`,
      name: '',
      argumentsText: '',
    });
  }

  const existing = toolCalls[index];
  if (id && !existing.id) {
    existing.id = id;
  }
  return existing;
};

const parseToolArguments = (argumentsText: string): Record<string, unknown> => {
  if (!argumentsText.trim()) {
    return {};
  }

  try {
    const parsed = JSON.parse(argumentsText);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Fall through to raw payload.
  }

  return {
    raw: argumentsText,
  };
};

const buildResponseFromAccumulator = (accumulator: StreamingAccumulator): LLMResponse => {
  const toolCalls: ToolCall[] = accumulator.toolCalls
    .filter((toolCall) => toolCall.id || toolCall.name || toolCall.argumentsText)
    .map((toolCall) => ({
      id: toolCall.id,
      name: toolCall.name,
      arguments: parseToolArguments(toolCall.argumentsText),
    }));

  return {
    id: accumulator.id,
    model: accumulator.model,
    content: accumulator.content,
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    usage: {
      inputTokens: accumulator.inputTokens,
      outputTokens: accumulator.outputTokens,
    },
    stopReason: accumulator.stopReason,
  };
};

const emitTextChunk = (text: string, onChunk: StreamCallback) => {
  if (!text) {
    return;
  }
  onChunk({
    type: 'text-delta',
    text,
  });
};

const emitToolCallDelta = (
  toolCall: {
    id: string;
    name?: string;
    argumentsText?: string;
  },
  onChunk: StreamCallback,
) => {
  onChunk({
    type: 'tool-call-delta',
    toolCall,
  });
};

const emitFallbackChunks = (text: string, onChunk: StreamCallback) => {
  const chunks = text
    .split(/(?<=[.!?。！？\n])|(?<=,|，)\s+/)
    .map((chunk) => chunk.trim())
    .filter(Boolean);

  if (chunks.length === 0 && text) {
    emitTextChunk(text, onChunk);
    return;
  }

  for (const chunk of chunks) {
    emitTextChunk(chunk, onChunk);
  }
};

const tryParseJson = <T = unknown>(value: string): T | null => {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
};

const mapFinishReason = (finishReason: string | null | undefined): LLMResponse['stopReason'] => {
  if (finishReason === 'tool_calls' || finishReason === 'tool_use') {
    return 'tool_use';
  }
  if (finishReason === 'length' || finishReason === 'max_tokens') {
    return 'max_tokens';
  }
  return 'end_turn';
};

const readSseStream = async (
  response: Response,
  onEvent: (eventName: string, data: string) => void,
) => {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('Streaming response body is unavailable.');
  }

  const decoder = new TextDecoder();
  let buffer = '';
  let eventName = 'message';
  let dataLines: string[] = [];

  const flush = () => {
    if (dataLines.length === 0) {
      eventName = 'message';
      return;
    }
    const payload = dataLines.join('\n');
    dataLines = [];
    onEvent(eventName, payload);
    eventName = 'message';
  };

  for (;;) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });

    let newlineIndex = buffer.indexOf('\n');
    while (newlineIndex >= 0) {
      const rawLine = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);
      const line = rawLine.replace(/\r$/, '');

      if (!line) {
        flush();
      } else if (line.startsWith('event:')) {
        eventName = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).trimStart());
      }

      newlineIndex = buffer.indexOf('\n');
    }

    if (done) {
      break;
    }
  }

  if (buffer.trim()) {
    const line = buffer.replace(/\r$/, '');
    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trimStart());
    }
  }

  flush();
};

abstract class BaseStreamingProvider implements LLMProvider {
  name: string;

  protected constructor(name: string) {
    this.name = name;
  }

  abstract chat(request: LLMRequest): Promise<LLMResponse>;

  async streamChat(request: LLMRequest, onChunk: StreamCallback): Promise<LLMResponse> {
    try {
      const response = await this.performStreamingChat(request, onChunk);
      onChunk({ type: 'done' });
      return response;
    } catch (error) {
      if (request.signal?.aborted) {
        throw error;
      }

      const fallbackResponse = await this.chat(request);
      const fallbackText = typeof fallbackResponse.content === 'string'
        ? fallbackResponse.content
        : JSON.stringify(fallbackResponse.content);
      emitFallbackChunks(fallbackText, onChunk);
      onChunk({ type: 'done' });
      return fallbackResponse;
    }
  }

  protected abstract performStreamingChat(request: LLMRequest, onChunk: StreamCallback): Promise<LLMResponse>;

  abstract isAvailable(): Promise<boolean>;

  abstract getModels(): string[];
}

class OpenRouterProvider extends BaseStreamingProvider {
  private apiKey = '';
  private baseUrl = 'https://openrouter.ai/api/v1';
  private models: string[] = [];

  constructor(name: string) {
    super(name);
  }

  configure(config: LLMProviderConfig): void {
    this.apiKey = config.apiKey.trim();
    this.baseUrl = normalizeOpenRouterBaseUrl(config.baseUrl || 'https://openrouter.ai/api/v1');
    this.models = config.models;
  }

  async chat(request: LLMRequest): Promise<LLMResponse> {
    const model = request.model?.trim();
    if (!model) {
      throw new Error(`${this.name} requires an explicit model selection.`);
    }
    const body: Record<string, unknown> = {
      model,
      messages: toContentBlocks(request.messages),
      max_tokens: request.maxTokens || 4096,
      temperature: request.temperature ?? 0.7,
      tools: toOpenAiTools(request.tools),
      response_format: request.responseFormat ? { type: request.responseFormat } : undefined,
      stream: false,
    };
    applyOpenAiCompatibleReasoning(body, request.reasoning);

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://rdcagent.local',
        'X-Title': 'RdcAgent',
      },
      signal: request.signal,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`OpenRouter API error: ${response.status} - ${await response.text()}`);
    }

    const data = await response.json();
    const choice = data.choices?.[0];
    const content = extractMessageContent(choice);

    return {
      id: data.id || `or-${Date.now()}`,
      model: data.model || model,
      content,
      toolCalls: choice?.message?.tool_calls as LLMResponse['toolCalls'],
      usage: {
        inputTokens: data.usage?.prompt_tokens || 0,
        outputTokens: data.usage?.completion_tokens || 0,
      },
      stopReason: mapFinishReason(choice?.finish_reason),
    };
  }

  protected async performStreamingChat(request: LLMRequest, onChunk: StreamCallback): Promise<LLMResponse> {
    const model = request.model?.trim();
    if (!model) {
      throw new Error(`${this.name} requires an explicit model selection.`);
    }

    const body: Record<string, unknown> = {
      model,
      messages: toContentBlocks(request.messages),
      max_tokens: request.maxTokens || 4096,
      temperature: request.temperature ?? 0.7,
      tools: toOpenAiTools(request.tools),
      response_format: request.responseFormat ? { type: request.responseFormat } : undefined,
      stream: true,
    };
    applyOpenAiCompatibleReasoning(body, request.reasoning);

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://rdcagent.local',
        'X-Title': 'RdcAgent',
      },
      signal: request.signal,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`OpenRouter API error: ${response.status} - ${await response.text()}`);
    }

    const accumulator = createAccumulator(model);

    await readSseStream(response, (_eventName, data) => {
      if (!data || data === '[DONE]') {
        return;
      }

      const payload = tryParseJson<Record<string, unknown>>(data);
      if (!payload) {
        return;
      }

      accumulator.id = String(payload.id || accumulator.id);
      accumulator.model = String(payload.model || accumulator.model);
      const choice = (payload.choices as Array<Record<string, unknown>> | undefined)?.[0];
      const delta = (choice?.delta as Record<string, unknown> | undefined) ?? {};
      const text = typeof delta.content === 'string' ? delta.content : '';
      if (text) {
        accumulator.content += text;
        emitTextChunk(text, onChunk);
      }

      const toolCalls = Array.isArray(delta.tool_calls) ? delta.tool_calls : [];
      for (const toolCallDelta of toolCalls) {
        const index = typeof toolCallDelta.index === 'number' ? toolCallDelta.index : 0;
        const functionDelta = typeof toolCallDelta.function === 'object' && toolCallDelta.function
          ? toolCallDelta.function as Record<string, unknown>
          : {};
        const toolCall = ensureToolCall(
          accumulator.toolCalls,
          index,
          typeof toolCallDelta.id === 'string' ? toolCallDelta.id : undefined,
        );
        if (typeof functionDelta.name === 'string') {
          toolCall.name = functionDelta.name;
        }
        if (typeof functionDelta.arguments === 'string') {
          toolCall.argumentsText += functionDelta.arguments;
        }
        emitToolCallDelta({
          id: toolCall.id,
          name: toolCall.name,
          argumentsText: toolCall.argumentsText,
        }, onChunk);
      }

      accumulator.stopReason = mapFinishReason(
        typeof choice?.finish_reason === 'string' ? choice.finish_reason : undefined,
      );
    });

    return buildResponseFromAccumulator(accumulator);
  }

  async isAvailable(): Promise<boolean> {
    return Boolean(this.apiKey);
  }

  getModels(): string[] {
    return this.models;
  }
}

class OpenAICompatibleProvider extends BaseStreamingProvider {
  protected apiKey = '';
  protected baseUrl = 'https://api.openai.com/v1';
  private models: string[] = [];
  private requireApiKey = true;

  constructor(name: string, requireApiKey = true) {
    super(name);
    this.requireApiKey = requireApiKey;
  }

  configure(config: LLMProviderConfig): void {
    this.apiKey = config.apiKey.trim();
    this.baseUrl = (config.baseUrl || this.baseUrl).trim().replace(/\/+$/, '');
    this.models = config.models;
  }

  protected createHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }

    return headers;
  }

  protected createChatCompletionsUrl(): string {
    return `${this.baseUrl}/chat/completions`;
  }

  protected describeApiError(status: number, text: string): string {
    return `${this.name} API error: ${status} - ${text}`;
  }

  async chat(request: LLMRequest): Promise<LLMResponse> {
    const model = request.model?.trim();
    if (!model) {
      throw new Error(`${this.name} requires an explicit model selection.`);
    }

    const body: Record<string, unknown> = {
      model,
      messages: toContentBlocks(request.messages),
      max_tokens: request.maxTokens || 4096,
      temperature: request.temperature ?? 0.7,
      tools: toOpenAiTools(request.tools),
      response_format: request.responseFormat ? { type: request.responseFormat } : undefined,
    };
    applyOpenAiCompatibleReasoning(body, request.reasoning);

    const response = await fetch(this.createChatCompletionsUrl(), {
      method: 'POST',
      headers: this.createHeaders(),
      signal: request.signal,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(this.describeApiError(response.status, await response.text()));
    }

    const data = await response.json();
    const choice = data.choices?.[0];
    const content = extractMessageContent(choice);

    return {
      id: data.id || `${this.name}-${Date.now()}`,
      model: data.model || model,
      content,
      toolCalls: choice?.message?.tool_calls as LLMResponse['toolCalls'],
      usage: {
        inputTokens: data.usage?.prompt_tokens || 0,
        outputTokens: data.usage?.completion_tokens || 0,
      },
      stopReason: mapFinishReason(choice?.finish_reason),
    };
  }

  protected async performStreamingChat(request: LLMRequest, onChunk: StreamCallback): Promise<LLMResponse> {
    const model = request.model?.trim();
    if (!model) {
      throw new Error(`${this.name} requires an explicit model selection.`);
    }

    const body: Record<string, unknown> = {
      model,
      messages: toContentBlocks(request.messages),
      max_tokens: request.maxTokens || 4096,
      temperature: request.temperature ?? 0.7,
      tools: toOpenAiTools(request.tools),
      response_format: request.responseFormat ? { type: request.responseFormat } : undefined,
      stream: true,
    };
    applyOpenAiCompatibleReasoning(body, request.reasoning);

    const response = await fetch(this.createChatCompletionsUrl(), {
      method: 'POST',
      headers: this.createHeaders(),
      signal: request.signal,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(this.describeApiError(response.status, await response.text()));
    }

    const accumulator = createAccumulator(model);

    await readSseStream(response, (_eventName, data) => {
      if (!data || data === '[DONE]') {
        return;
      }

      const payload = tryParseJson<Record<string, unknown>>(data);
      if (!payload) {
        return;
      }

      accumulator.id = String(payload.id || accumulator.id);
      accumulator.model = String(payload.model || accumulator.model);

      const choice = (payload.choices as Array<Record<string, unknown>> | undefined)?.[0];
      const delta = (choice?.delta as Record<string, unknown> | undefined) ?? {};
      const text = typeof delta.content === 'string' ? delta.content : '';
      if (text) {
        accumulator.content += text;
        emitTextChunk(text, onChunk);
      }

      const toolCalls = Array.isArray(delta.tool_calls) ? delta.tool_calls : [];
      for (const toolCallDelta of toolCalls) {
        const index = typeof toolCallDelta.index === 'number' ? toolCallDelta.index : 0;
        const functionDelta = typeof toolCallDelta.function === 'object' && toolCallDelta.function
          ? toolCallDelta.function as Record<string, unknown>
          : {};
        const toolCall = ensureToolCall(
          accumulator.toolCalls,
          index,
          typeof toolCallDelta.id === 'string' ? toolCallDelta.id : undefined,
        );
        if (typeof functionDelta.name === 'string') {
          toolCall.name = functionDelta.name;
        }
        if (typeof functionDelta.arguments === 'string') {
          toolCall.argumentsText += functionDelta.arguments;
        }
        emitToolCallDelta({
          id: toolCall.id,
          name: toolCall.name,
          argumentsText: toolCall.argumentsText,
        }, onChunk);
      }

      accumulator.stopReason = mapFinishReason(
        typeof choice?.finish_reason === 'string' ? choice.finish_reason : undefined,
      );
    });

    return buildResponseFromAccumulator(accumulator);
  }

  async isAvailable(): Promise<boolean> {
    return this.requireApiKey ? Boolean(this.apiKey) : true;
  }

  getModels(): string[] {
    return this.models;
  }
}

class ChatGptAccountProvider extends BaseStreamingProvider {
  private accessToken = '';
  private baseUrl = 'https://chatgpt.com/backend-api/codex';
  private accountId?: string;
  private models: string[] = [];

  constructor(name: string) {
    super(name);
  }

  configure(config: LLMProviderConfig): void {
    this.accessToken = config.apiKey.trim();
    this.baseUrl = (config.baseUrl || this.baseUrl).trim().replace(/\/+$/, '');
    this.accountId = config.accountId?.trim() || undefined;
    this.models = config.models;
  }

  private createHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.accessToken}`,
      'Content-Type': 'application/json',
    };
    if (this.accountId) {
      headers['chatgpt-account-id'] = this.accountId;
    }
    return headers;
  }

  private createResponsesUrl(): string {
    return this.baseUrl.endsWith('/responses') ? this.baseUrl : `${this.baseUrl}/responses`;
  }

  private createBody(request: LLMRequest, model: string, stream: boolean): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model,
      input: toResponsesInput(request.messages),
      max_output_tokens: request.maxTokens || 4096,
      temperature: request.temperature ?? 0.7,
      stream,
    };
    const reasoningPayload = buildOpenAiResponsesReasoning(request.reasoning);
    if (reasoningPayload.reasoning) {
      body.reasoning = reasoningPayload.reasoning;
    }
    if (reasoningPayload.include) {
      body.include = reasoningPayload.include;
    }
    if (request.responseFormat) {
      body.text = { format: { type: request.responseFormat } };
    }
    const tools = toResponsesTools(request.tools);
    if (tools) {
      body.tools = tools;
      body.tool_choice = 'auto';
    }
    return body;
  }

  async chat(request: LLMRequest): Promise<LLMResponse> {
    const model = request.model?.trim();
    if (!model) {
      throw new Error(`${this.name} requires an explicit model selection.`);
    }

    const response = await fetch(this.createResponsesUrl(), {
      method: 'POST',
      headers: this.createHeaders(),
      signal: request.signal,
      body: JSON.stringify(this.createBody(request, model, false)),
    });

    if (!response.ok) {
      throw new Error(`ChatGPT Account API error: ${response.status} - ${await response.text()}`);
    }

    const payload = await response.json() as Record<string, unknown>;
    return {
      id: typeof payload.id === 'string' ? payload.id : `${this.name}-${Date.now()}`,
      model: typeof payload.model === 'string' ? payload.model : model,
      content: extractResponsesText(payload),
      usage: extractResponsesUsage(payload),
      stopReason: mapFinishReason(typeof payload.status === 'string' ? payload.status : undefined),
    };
  }

  protected async performStreamingChat(request: LLMRequest, onChunk: StreamCallback): Promise<LLMResponse> {
    const model = request.model?.trim();
    if (!model) {
      throw new Error(`${this.name} requires an explicit model selection.`);
    }

    const response = await fetch(this.createResponsesUrl(), {
      method: 'POST',
      headers: this.createHeaders(),
      signal: request.signal,
      body: JSON.stringify(this.createBody(request, model, true)),
    });

    if (!response.ok) {
      throw new Error(`ChatGPT Account API error: ${response.status} - ${await response.text()}`);
    }

    const accumulator = createAccumulator(model);
    await readSseStream(response, (eventName, data) => {
      if (!data || data === '[DONE]') {
        return;
      }

      const payload = tryParseJson<Record<string, unknown>>(data);
      if (!payload) {
        return;
      }

      const eventType = typeof payload.type === 'string' ? payload.type : eventName;
      if (typeof payload.id === 'string') {
        accumulator.id = payload.id;
      }
      if (typeof payload.model === 'string') {
        accumulator.model = payload.model;
      }

      if (eventType.includes('output_text.delta')) {
        const text = typeof payload.delta === 'string'
          ? payload.delta
          : typeof payload.text === 'string'
            ? payload.text
            : '';
        if (text) {
          accumulator.content += text;
          emitTextChunk(text, onChunk);
        }
      }

      if (eventType.includes('completed')) {
        const completed = payload.response && typeof payload.response === 'object'
          ? payload.response as Record<string, unknown>
          : payload;
        if (!accumulator.content) {
          accumulator.content = extractResponsesText(completed);
        }
        if (typeof completed.id === 'string') {
          accumulator.id = completed.id;
        }
        if (typeof completed.model === 'string') {
          accumulator.model = completed.model;
        }
        const usage = extractResponsesUsage(completed);
        accumulator.inputTokens = usage.inputTokens;
        accumulator.outputTokens = usage.outputTokens;
      }
    });

    return buildResponseFromAccumulator(accumulator);
  }

  async isAvailable(): Promise<boolean> {
    return Boolean(this.accessToken);
  }

  getModels(): string[] {
    return this.models;
  }
}

class GitHubCopilotProvider extends OpenAICompatibleProvider {
  constructor(name: string) {
    super(name, true);
  }

  protected createHeaders(): Record<string, string> {
    return {
      ...super.createHeaders(),
      ...COPILOT_WIRE_HEADERS,
    };
  }

  protected describeApiError(status: number, text: string): string {
    if (status === 401) {
      return `GitHub Copilot account token was rejected. Sign in again or check token policy. ${text}`;
    }
    if (status === 403) {
      return `GitHub Copilot access was blocked by license, organization, or policy settings. ${text}`;
    }
    return `GitHub Copilot API error: ${status} - ${text}`;
  }
}

class AzureOpenAIProvider extends OpenAICompatibleProvider {
  protected createHeaders(): Record<string, string> {
    return {
      'api-key': this.apiKey,
      'Content-Type': 'application/json',
    };
  }

  protected createChatCompletionsUrl(): string {
    const base = this.baseUrl.endsWith('/chat/completions')
      ? this.baseUrl
      : `${this.baseUrl}/chat/completions`;
    return appendQueryParam(base, 'api-version', '2024-10-21');
  }
}

class GoogleAiStudioProvider extends BaseStreamingProvider {
  private apiKey = '';
  private baseUrl = 'https://generativelanguage.googleapis.com/v1beta';
  private models: string[] = [];
  private useBearerAuth = false;

  constructor(name: string) {
    super(name);
  }

  configure(config: LLMProviderConfig): void {
    this.apiKey = config.apiKey.trim();
    this.baseUrl = (config.baseUrl || this.baseUrl).trim().replace(/\/+$/, '');
    this.models = config.models;
    this.useBearerAuth = config.authMode === 'account';
  }

  private createGenerateContentUrl(model: string): string {
    const base = `${this.baseUrl}/models/${model}:generateContent`;
    return this.useBearerAuth ? base : appendQueryParam(base, 'key', this.apiKey);
  }

  private createHeaders(): Record<string, string> {
    return {
      ...(this.useBearerAuth ? { Authorization: `Bearer ${this.apiKey}` } : {}),
      'Content-Type': 'application/json',
    };
  }

  async chat(request: LLMRequest): Promise<LLMResponse> {
    const model = request.model?.trim();
    if (!model) {
      throw new Error(`${this.name} requires an explicit model selection.`);
    }
    const generationConfig: Record<string, unknown> = {
      maxOutputTokens: request.maxTokens || 4096,
      temperature: request.temperature ?? 0.7,
    };
    applyGeminiReasoning(generationConfig, request.reasoning);

    const response = await fetch(this.createGenerateContentUrl(model), {
      method: 'POST',
      headers: this.createHeaders(),
      signal: request.signal,
      body: JSON.stringify({
        contents: request.messages
          .filter((message) => message.role !== 'system')
          .map((message) => ({
            role: message.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: typeof message.content === 'string' ? message.content : JSON.stringify(message.content) }],
          })),
        generationConfig,
        systemInstruction: request.messages.some((message) => message.role === 'system')
          ? {
              parts: request.messages
                .filter((message) => message.role === 'system')
                .map((message) => ({ text: typeof message.content === 'string' ? message.content : JSON.stringify(message.content) })),
            }
          : undefined,
      }),
    });

    if (!response.ok) {
      throw new Error(`Google AI Studio API error: ${response.status} - ${await response.text()}`);
    }

    const data = await response.json();
    const text = Array.isArray(data.candidates?.[0]?.content?.parts)
      ? data.candidates[0].content.parts
          .map((part: { text?: unknown }) => (typeof part.text === 'string' ? part.text : ''))
          .join('')
      : '';

    return {
      id: data.responseId || `google-ai-studio-${Date.now()}`,
      model,
      content: text,
      usage: {
        inputTokens: data.usageMetadata?.promptTokenCount || 0,
        outputTokens: data.usageMetadata?.candidatesTokenCount || 0,
      },
      stopReason: 'end_turn',
    };
  }

  protected async performStreamingChat(request: LLMRequest, onChunk: StreamCallback): Promise<LLMResponse> {
    const response = await this.chat(request);
    const text = typeof response.content === 'string' ? response.content : JSON.stringify(response.content);
    emitTextChunk(text, onChunk);
    return response;
  }

  async isAvailable(): Promise<boolean> {
    return Boolean(this.apiKey);
  }

  getModels(): string[] {
    return this.models;
  }
}

class AnthropicProvider extends BaseStreamingProvider {
  private apiKey = '';
  private baseUrl = 'https://api.anthropic.com/v1';
  private models: string[] = [];
  private useBearerAuth = false;

  constructor(name: string) {
    super(name);
  }

  configure(config: LLMProviderConfig): void {
    this.apiKey = config.apiKey.trim();
    this.baseUrl = (config.baseUrl || 'https://api.anthropic.com/v1').trim().replace(/\/+$/, '');
    this.models = config.models;
    this.useBearerAuth = config.authMode === 'account';
  }

  private createHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      ...(this.useBearerAuth ? { Authorization: `Bearer ${this.apiKey}` } : { 'x-api-key': this.apiKey }),
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    };
    if (this.name === 'kimi-coding-plan') {
      headers['User-Agent'] = 'RDC-Agent';
    }
    return headers;
  }

  async chat(request: LLMRequest): Promise<LLMResponse> {
    const model = request.model?.trim();
    if (!model) {
      throw new Error(`${this.name} requires an explicit model selection.`);
    }
    const systemMessage = request.messages.find((message) => message.role === 'system');
    const otherMessages = request.messages.filter((message) => message.role !== 'system');

    const body: Record<string, unknown> = {
      model,
      max_tokens: request.maxTokens || 4096,
      system: typeof systemMessage?.content === 'string' ? systemMessage.content : undefined,
      messages: otherMessages.map((message) => ({
        role: message.role === 'assistant' ? 'assistant' : 'user',
        content: message.content,
      })),
    };
    applyReasoningToAnthropicLikeBody(body, request.reasoning);

    const response = await fetch(`${this.baseUrl}/messages`, {
      method: 'POST',
      headers: this.createHeaders(),
      signal: request.signal,
      body: JSON.stringify(body),
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
      stopReason: mapFinishReason(data.stop_reason),
    };
  }

  protected async performStreamingChat(request: LLMRequest, onChunk: StreamCallback): Promise<LLMResponse> {
    const model = request.model?.trim();
    if (!model) {
      throw new Error(`${this.name} requires an explicit model selection.`);
    }
    const systemMessage = request.messages.find((message) => message.role === 'system');
    const otherMessages = request.messages.filter((message) => message.role !== 'system');

    const body: Record<string, unknown> = {
      model,
      max_tokens: request.maxTokens || 4096,
      stream: true,
      system: typeof systemMessage?.content === 'string' ? systemMessage.content : undefined,
      messages: otherMessages.map((message) => ({
        role: message.role === 'assistant' ? 'assistant' : 'user',
        content: message.content,
      })),
    };
    applyReasoningToAnthropicLikeBody(body, request.reasoning);

    const response = await fetch(`${this.baseUrl}/messages`, {
      method: 'POST',
      headers: this.createHeaders(),
      signal: request.signal,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`Anthropic API error: ${response.status} - ${await response.text()}`);
    }

    const accumulator = createAccumulator(model);

    await readSseStream(response, (eventName, data) => {
      if (!data) {
        return;
      }

      const payload = tryParseJson<Record<string, unknown>>(data);
      if (!payload) {
        return;
      }

      if (eventName === 'message_start') {
        const message = payload.message as Record<string, unknown> | undefined;
        accumulator.id = String(message?.id || accumulator.id);
        accumulator.model = String(message?.model || accumulator.model);
        const usage = message?.usage as Record<string, unknown> | undefined;
        accumulator.inputTokens = typeof usage?.input_tokens === 'number' ? usage.input_tokens : accumulator.inputTokens;
      }

      if (eventName === 'content_block_delta') {
        const delta = payload.delta as Record<string, unknown> | undefined;
        if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
          accumulator.content += delta.text;
          emitTextChunk(delta.text, onChunk);
        }
      }

      if (eventName === 'message_delta') {
        const delta = payload.delta as Record<string, unknown> | undefined;
        const usage = payload.usage as Record<string, unknown> | undefined;
        accumulator.outputTokens = typeof usage?.output_tokens === 'number' ? usage.output_tokens : accumulator.outputTokens;
        accumulator.stopReason = mapFinishReason(
          typeof delta?.stop_reason === 'string' ? delta.stop_reason : undefined,
        );
      }
    });

    return buildResponseFromAccumulator(accumulator);
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

class UnsupportedProtocolProvider implements LLMProvider {
  readonly name: string;
  private readonly error: Error;

  constructor(providerId: string, protocol: unknown) {
    this.name = providerId;
    this.error = new Error(describeUnsupportedProtocol(providerId, protocol));
  }

  async chat(): Promise<LLMResponse> {
    throw this.error;
  }

  async streamChat(): Promise<LLMResponse> {
    throw this.error;
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }

  getModels(): string[] {
    return [];
  }
}

const createProviderByProtocol = (providerConfig: LLMProviderConfig): LLMProvider => {
  const protocol = providerConfig.protocol;
  if (providerConfig.id === 'github-copilot') {
    return protocol === 'OpenAICompatibleChatCompletions'
      ? new GitHubCopilotProvider(providerConfig.id)
      : new UnsupportedProtocolProvider(providerConfig.id, protocol);
  }

  switch (protocol) {
    case 'OpenRouterChatCompletions':
      return new OpenRouterProvider(providerConfig.id);
    case 'AnthropicMessages':
      return new AnthropicProvider(providerConfig.id);
    case 'OpenAIResponses':
      return new ChatGptAccountProvider(providerConfig.id);
    case 'OpenAICompatibleChatCompletions':
      return new OpenAICompatibleProvider(providerConfig.id, true);
    case 'OllamaOpenAICompatibleChatCompletions':
      return new OpenAICompatibleProvider(providerConfig.id, false);
    case 'GoogleGemini':
      return new GoogleAiStudioProvider(providerConfig.id);
    case 'AzureOpenAIChatCompletions':
      return new AzureOpenAIProvider(providerConfig.id);
    case 'AwsBedrock':
    case 'GoogleVertexAI':
    default:
      return new UnsupportedProtocolProvider(providerConfig.id, protocol);
  }
};

export class LLMAdapter {
  private providers = new Map<string, RuntimeProviderEntry>();

  configure(config: LLMConfig): void {
    this.providers.clear();

    for (const providerConfig of config.providers) {
      const provider = createProviderByProtocol(providerConfig);
      if ('configure' in provider && typeof (provider as { configure?: (next: LLMProviderConfig) => void }).configure === 'function') {
        (provider as { configure: (next: LLMProviderConfig) => void }).configure(providerConfig);
      }

      this.providers.set(providerConfig.id, {
        config: providerConfig,
        provider,
      });
    }
  }

  async chat(request: LLMRequest, providerId?: string): Promise<LLMResponse> {
    const resolvedProviderId = providerId?.trim();
    if (!resolvedProviderId) {
      throw new Error('No explicit LLM provider was supplied for this request.');
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
    const resolvedProviderId = providerId?.trim();
    if (!resolvedProviderId) {
      throw new Error('No explicit LLM provider was supplied for this request.');
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
    return '';
  }
}

export const llmAdapter = new LLMAdapter();
