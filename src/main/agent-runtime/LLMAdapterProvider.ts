/**
 * LLMAdapterProvider — 把现有 `llmAdapter.streamChat` 包装成新 Agent Runtime
 * `ProviderStrategy`，让 Agent 类可以复用所有 settings 层注册的 provider
 * （含 OAuth/账户态、自定义 baseUrl、Copilot bridge 等）。
 *
 * 设计目标：
 * 1. 不重写已有 provider 实现：所有真实 HTTP/SSE 解析、凭证刷新仍在
 *    `LLMAdapter` 中执行。
 * 2. 在新旧两套类型之间做一次显式翻译：
 *    - new `Context` / `Model` → 旧 `LLMRequest` / `LLMMessage`；
 *    - 旧 `LLMStreamEvent` → 新 `AssistantMessageEvent`；
 *    - 旧 `LLMResponse` → 新 `AssistantMessage`。
 * 3. `model.id` 携带 `<providerId>::<modelId>` 编码，确保从 `Model` 单一对象
 *    即可路由到具体 provider；上层使用 `encodeAgentModel` 帮助构造。
 */

import type {
  LLMMessage,
  LLMRequest,
  LLMStreamEvent,
  ToolDefinition as LegacyToolDefinition,
} from '@shared/types/llm';
import { llmAdapter } from '../settings/LLMAdapter';
import { EventStream } from './core/EventStream';
import type { ProviderStrategy } from './core/ProviderRegistry';
import type {
  AssistantMessage,
  AssistantMessageEvent,
  Context,
  JsonSchema,
  Message,
  Model,
  ProviderCapabilities,
  StopReason,
  StreamOptions,
  TextContent,
  ThinkingContent,
  ToolCall,
  ToolDefinition,
} from './core/types';
import { AssistantStreamBuilder } from './providers/internal/AssistantStreamBuilder';

/** 把 (providerId, modelId) 编码成新 Agent Runtime 的 `Model` 描述。 */
export function encodeAgentModel(providerId: string, modelId: string): Model {
  return {
    id: `${providerId}::${modelId}`,
    name: modelId,
    provider: providerId,
    api: 'rdc-agent-llm-adapter',
    contextWindow: 0,
    maxTokens: 0,
    reasoning: false,
    vision: false,
  };
}

/** 从编码后的 `Model` 中解析回真实的 (providerId, modelId)。 */
export function decodeAgentModel(model: Model): { providerId: string; modelId: string } {
  const [providerPart, ...modelParts] = model.id.split('::');
  if (modelParts.length === 0) {
    return { providerId: model.provider, modelId: model.id };
  }
  return { providerId: providerPart || model.provider, modelId: modelParts.join('::') };
}

/** 把新 `Message[]` 序列化为旧 `LLMMessage[]`（保留 system 提示词）。 */
function messagesToLlm(systemPrompt: string | undefined, messages: Message[]): LLMMessage[] {
  const result: LLMMessage[] = [];
  if (systemPrompt && systemPrompt.trim()) {
    result.push({ role: 'system', content: systemPrompt });
  }
  for (const msg of messages) {
    if (msg.role === 'user') {
      result.push({ role: 'user', content: typeof msg.content === 'string' ? msg.content : userContentToText(msg.content) });
    } else if (msg.role === 'assistant') {
      result.push({ role: 'assistant', content: assistantContentToText(msg.content) });
    } else if (msg.role === 'toolResult') {
      result.push({
        role: 'tool',
        content: msg.content.map((block) => (block.type === 'text' ? block.text : '')).join('\n'),
      });
    }
  }
  return result;
}

function toolsToLlm(tools: ToolDefinition[] | undefined): LegacyToolDefinition[] | undefined {
  if (!tools?.length) return undefined;
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: normalizeLegacyJsonSchema(tool.parameters),
  }));
}

function normalizeLegacyJsonSchema(schema: JsonSchema): LegacyToolDefinition['input_schema'] {
  const properties: LegacyToolDefinition['input_schema']['properties'] = {};
  for (const [key, value] of Object.entries(schema.properties ?? {})) {
    properties[key] = {
      type: typeof value.type === 'string' ? value.type : 'string',
      description: typeof value.description === 'string' ? value.description : '',
      enum: Array.isArray(value.enum) ? value.enum.map(String) : undefined,
    };
  }
  return {
    type: 'object',
    properties,
    required: schema.required,
  };
}

function userContentToText(content: Array<{ type: string; text?: string }>): string {
  return content.map((block) => (block.type === 'text' && typeof block.text === 'string' ? block.text : '')).join('');
}

function assistantContentToText(content: Array<TextContent | ThinkingContent | ToolCall>): string {
  const parts: string[] = [];
  for (const block of content) {
    if (block.type === 'text') {
      parts.push(block.text);
    } else if (block.type === 'thinking') {
      // 思考内容不送回模型，避免 reasoning 泄漏
      continue;
    } else if (block.type === 'toolCall') {
      parts.push(`[tool ${block.name} requested]`);
    }
  }
  return parts.join('');
}

/** 旧 `LLMStreamEvent` 映射为新 `AssistantMessageEvent`，构造 partial 助手消息。 */
/** 真正的 ProviderStrategy 实现：流式调用 llmAdapter 并翻译事件。 */
export class LLMAdapterProvider implements ProviderStrategy {
  readonly api = 'rdc-agent-llm-adapter';

  getCapabilities(): ProviderCapabilities {
    return {
      streaming: true,
      nativeToolCalling: false,
      structuredOutput: false,
      vision: false,
      reasoning: false,
      parallelToolCalls: false,
    };
  }

  stream(
    model: Model,
    context: Context,
    options?: StreamOptions,
  ): EventStream<AssistantMessageEvent, AssistantMessage> {
    const { providerId, modelId } = decodeAgentModel(model);
    const stream = new EventStream<AssistantMessageEvent, AssistantMessage>(
      (event) => event.type === 'done' || event.type === 'error',
      (event) => (event as { message: AssistantMessage }).message,
    );

    const builder = new AssistantStreamBuilder(stream, model.id, providerId);
    const toolIndexes = new Map<string, { index: number; argumentsText: string }>();
    let sawTextDelta = false;

    // start 事件
    builder.start();

    const llmRequest: LLMRequest = {
      messages: messagesToLlm(context.systemPrompt, context.messages as Message[]),
      model: modelId,
      maxTokens: options?.maxTokens,
      temperature: options?.temperature,
      tools: toolsToLlm(context.tools),
      reasoningBudget: options?.reasoningBudget,
      signal: options?.signal,
    };

    const onChunk = (chunk: LLMStreamEvent): void => {
      if (stream.isDone) return;
      if (chunk.type === 'text-delta') {
        sawTextDelta = true;
        builder.appendText(0, chunk.text);
      } else if (chunk.type === 'tool-call-delta') {
        const toolCall = chunk.toolCall;
        const id = toolCall.id || `tool-call-${toolIndexes.size}`;
        let entry = toolIndexes.get(id);
        if (!entry) {
          entry = { index: toolIndexes.size + 1, argumentsText: '' };
          toolIndexes.set(id, entry);
        }
        builder.ensureToolCall(entry.index, id, toolCall.name ?? '');
        if (typeof toolCall.argumentsText === 'string') {
          const delta = toolCall.argumentsText.startsWith(entry.argumentsText)
            ? toolCall.argumentsText.slice(entry.argumentsText.length)
            : toolCall.argumentsText;
          entry.argumentsText = toolCall.argumentsText;
          builder.appendToolCallArgs(entry.index, delta);
        }
      }
      // tool-call-delta / done / error 不在此映射；done/error 由 await 后逻辑处理。
    };

    void this.runStream(llmRequest, providerId, builder, stream, onChunk, () => sawTextDelta, toolIndexes);

    return stream;
  }

  private async runStream(
    request: LLMRequest,
    providerId: string,
    builder: AssistantStreamBuilder,
    stream: EventStream<AssistantMessageEvent, AssistantMessage>,
    onChunk: (event: LLMStreamEvent) => void,
    hasStreamedText: () => boolean,
    streamedToolIndexes: Map<string, { index: number; argumentsText: string }>,
  ): Promise<void> {
    try {
      const response = await llmAdapter.streamChat(request, onChunk, providerId);
      if (stream.isDone) return;

      if (!hasStreamedText() && typeof response.content === 'string' && response.content) {
        builder.appendText(0, response.content);
      }
      appendFinalToolCalls(builder, response.toolCalls, streamedToolIndexes);
      builder.setUsage({
        inputTokens: response.usage.inputTokens,
        outputTokens: response.usage.outputTokens,
        totalTokens: response.usage.inputTokens + response.usage.outputTokens,
      });
      builder.done(mapStopReason(response.stopReason));
    } catch (error) {
      if (stream.isDone) return;
      const err = error instanceof Error ? error : new Error(String(error));
      builder.fail(err);
    }
  }
}

function appendFinalToolCalls(
  builder: AssistantStreamBuilder,
  toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }> | undefined,
  streamedToolIndexes: Map<string, { index: number; argumentsText: string }>,
): void {
  if (!toolCalls?.length) return;
  toolCalls.forEach((toolCall, index) => {
    const existing = streamedToolIndexes.get(toolCall.id);
    const contentIndex = existing?.index ?? index + 1;
    if (existing) {
      builder.endToolCall(contentIndex);
      return;
    }
    builder.ensureToolCall(contentIndex, toolCall.id, toolCall.name);
    builder.appendToolCallArgs(contentIndex, JSON.stringify(toolCall.arguments ?? {}));
    builder.endToolCall(contentIndex);
  });
}

function mapStopReason(reason: 'end_turn' | 'tool_use' | 'max_tokens' | undefined): StopReason {
  if (reason === 'tool_use') return 'toolUse';
  if (reason === 'max_tokens') return 'length';
  return 'stop';
}

/** 单例。Agent 构造时直接传入即可。 */
export const llmAdapterProvider = new LLMAdapterProvider();
