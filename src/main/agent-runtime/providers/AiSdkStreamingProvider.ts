import {
  jsonSchema,
  streamText,
  tool,
  type LanguageModel,
  type ModelMessage,
  type TextStreamPart,
  type ToolSet,
} from 'ai';
import type { SharedV3ProviderOptions } from '@ai-sdk/provider';
import { EventStream } from '../core/EventStream';
import type { ProviderStrategy } from '../core/ProviderRegistry';
import type {
  AssistantMessage,
  AssistantMessageEvent,
  Context,
  Message,
  Model,
  StopReason,
  StreamOptions,
} from '../core/types';
import { AssistantStreamBuilder } from './internal/AssistantStreamBuilder';
import { composeAbortSignals, normalizeError } from './internal/http';

type RuntimeLanguageModel = Exclude<LanguageModel, string>;
export interface AiSdkStreamingProviderOptions {
  api: string;
  createModel: (model: Model, context: Context, options: StreamOptions) => Promise<RuntimeLanguageModel>;
  providerOptions?: (options: StreamOptions) => SharedV3ProviderOptions | undefined;
}
export class AiSdkStreamingProvider implements ProviderStrategy {
  readonly api: string;
  private readonly createModel: AiSdkStreamingProviderOptions['createModel'];
  private readonly resolveProviderOptions: AiSdkStreamingProviderOptions['providerOptions'];
  constructor(options: AiSdkStreamingProviderOptions) {
    this.api = options.api;
    this.createModel = options.createModel;
    this.resolveProviderOptions = options.providerOptions;
  }
  stream(model: Model, context: Context, options: StreamOptions): EventStream<AssistantMessageEvent, AssistantMessage> {
    const stream = new EventStream<AssistantMessageEvent, AssistantMessage>(
      (event) => event.type === 'done',
      (event) => (event as Extract<AssistantMessageEvent, { type: 'done' }>).message,
    );
    const builder = new AssistantStreamBuilder(stream, model.id, model.provider);
    void this.run(stream, builder, model, context, options);
    return stream;
  }
  private async run(
    stream: EventStream<AssistantMessageEvent, AssistantMessage>,
    builder: AssistantStreamBuilder,
    model: Model,
    context: Context,
    options: StreamOptions,
  ): Promise<void> {
    const composed = composeAbortSignals(options.signal, stream.signal, { providerApi: this.api, ...options });
    try {
      builder.start();
      if (options.requestPlan.effectiveModelId !== model.id) throw new Error(
        `RequestPlan model ${options.requestPlan.effectiveModelId} does not match ${model.id}.`,
      );
      const languageModel = await this.createModel(model, context, options);
      const result = streamText({
        model: languageModel,
        system: context.systemPrompt,
        messages: toModelMessages(context.messages),
        tools: toAiSdkTools(context),
        maxOutputTokens: options.maxTokens ?? model.maxTokens,
        temperature: options.temperature,
        topP: options.topP,
        providerOptions: this.resolveProviderOptions?.(options),
        abortSignal: composed.signal,
        maxRetries: 0,
      });
      await consumeFullStream(result.fullStream, builder, model);
      if (!builder.isFinished) builder.done('stop');
    } catch (error) {
      if (!builder.isFinished) {
        builder.fail(normalizeError(error), composed.signal.aborted ? 'aborted' : 'error');
      }
    } finally {
      composed.dispose();
    }
  }
}

function toAiSdkTools(context: Context): ToolSet | undefined {
  if (!context.tools?.length) return undefined;
  return Object.fromEntries(context.tools.map((entry) => [entry.name, tool({
    description: entry.description,
    inputSchema: jsonSchema(entry.parameters),
  })]));
}

function toModelMessages(messages: Message[]): ModelMessage[] {
  return messages.map((message): ModelMessage => {
    if (message.role === 'user') {
      return {
        role: 'user',
        content: typeof message.content === 'string'
          ? message.content
          : message.content.map((block) => block.type === 'text'
            ? { type: 'text' as const, text: block.text }
            : { type: 'image' as const, image: block.data, mediaType: block.mimeType }),
      };
    }
    if (message.role === 'assistant') {
      const content: Array<
        | { type: 'text'; text: string }
        | { type: 'tool-call'; toolCallId: string; toolName: string; input: unknown }
      > = [];
      for (const block of message.content) {
        if (block.type === 'text') content.push({ type: 'text', text: block.text });
        else if (block.type === 'toolCall') {
          content.push({
            type: 'tool-call',
            toolCallId: block.id,
            toolName: block.name,
            input: block.arguments,
          });
        }
      }
      return { role: 'assistant', content };
    }
    const content = message.content.map((block) => block.type === 'text'
      ? { type: 'text' as const, text: block.text }
      : { type: 'image-data' as const, data: block.data, mediaType: block.mimeType });
    return {
      role: 'tool',
      content: [{
        type: 'tool-result',
        toolCallId: message.toolCallId,
        toolName: message.toolName,
        output: message.isError
          ? { type: 'error-text', value: content.filter((part) => part.type === 'text').map((part) => part.text).join('\n') }
          : { type: 'content', value: content },
      }],
    };
  });
}

async function consumeFullStream(
  parts: AsyncIterable<TextStreamPart<ToolSet>>,
  builder: AssistantStreamBuilder,
  model: Model,
): Promise<void> {
  const indexes = new Map<string, number>();
  const toolBuffers = new Map<string, string>();
  let nextIndex = 0;
  const indexFor = (id: string): number => {
    const existing = indexes.get(id);
    if (existing !== undefined) return existing;
    const created = nextIndex++;
    indexes.set(id, created);
    return created;
  };
  for await (const part of parts) {
    const partWithId = part as TextStreamPart<ToolSet> & { id?: string };
    if (part.type === 'text-delta') builder.appendText(indexFor(part.id), part.text);
    else if (part.type === 'text-end') builder.endText(indexFor(part.id));
    else if (part.type === 'reasoning-delta') {
      builder.appendThinking(indexFor(part.id), part.text, {
        kind: 'unknown', source: 'unknown', visibility: 'raw-collapsed', replayPolicy: 'none',
        artifact: { providerId: model.provider, modelId: model.id, protocol: model.api, type: 'ai-sdk-reasoning' },
      });
    } else if (part.type === 'reasoning-end') builder.endThinking(indexFor(part.id));
    else if (part.type === 'tool-input-start') {
      builder.ensureToolCall(indexFor(part.id), part.id, part.toolName);
      toolBuffers.set(part.id, '');
    } else if (part.type === 'tool-input-delta') {
      builder.appendToolCallArgs(indexFor(part.id), part.delta);
      toolBuffers.set(part.id, `${toolBuffers.get(part.id) ?? ''}${part.delta}`);
    } else if (part.type === 'tool-call') {
      const index = indexFor(part.toolCallId);
      builder.ensureToolCall(index, part.toolCallId, part.toolName);
      if (!toolBuffers.get(part.toolCallId)) builder.appendToolCallArgs(index, JSON.stringify(part.input ?? {}));
      builder.endToolCall(index);
    } else if (part.type === 'finish') {
      builder.setUsage({
        inputTokens: part.totalUsage.inputTokens ?? 0,
        outputTokens: part.totalUsage.outputTokens ?? 0,
        totalTokens: part.totalUsage.totalTokens ?? undefined,
        cacheReadTokens: part.totalUsage.inputTokenDetails.cacheReadTokens ?? undefined,
        cacheWriteTokens: part.totalUsage.inputTokenDetails.cacheWriteTokens ?? undefined,
        reasoningTokens: part.totalUsage.outputTokenDetails.reasoningTokens ?? undefined,
      });
      builder.done(mapFinishReason(part.finishReason));
    } else if (part.type === 'abort') builder.done('aborted');
    else if (part.type === 'error') throw normalizeError(part.error);
    else if (partWithId.id && (part.type === 'text-start' || part.type === 'reasoning-start')) indexFor(partWithId.id);
  }
}

function mapFinishReason(reason: string): StopReason {
  if (reason === 'length') return 'length';
  if (reason === 'tool-calls') return 'toolUse';
  if (reason === 'content-filter') return 'refusal';
  if (reason === 'error') return 'error';
  return 'stop';
}
