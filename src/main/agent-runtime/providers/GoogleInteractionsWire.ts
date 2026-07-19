import type { RequestPlan } from '@shared/types/providerCapability';
import type {
  Context,
  Message,
  Model,
  StreamOptions,
  ToolDefinition,
} from '../core/types';
import { decideContinuationReplay } from '../reasoning/ContinuationReplayPolicy';
import { findLatestProviderState } from '../reasoning/ProviderStateRefs';
import { applyGoogleInteractionsReasoning } from './reasoningWire';

export function buildGoogleInteractionsUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/u, '');
  if (!trimmed) throw new Error('Google Interactions base URL is required.');
  return trimmed.endsWith('/interactions') ? trimmed : `${trimmed}/interactions`;
}

export function buildGoogleInteractionsRequest(
  model: Model,
  context: Context,
  options: StreamOptions,
): Record<string, unknown> {
  const providerState = findLatestProviderState(context, options.requestPlan);
  const messages = providerState
    ? context.messages.slice(providerState.assistantMessageIndex + 1)
    : context.messages;
  const body: Record<string, unknown> = {
    model: model.id,
    input: toGoogleInteractionSteps(messages, options.requestPlan),
    stream: true,
    store: options.requestPlan.statePlan.store,
  };
  if (providerState) body.previous_interaction_id = providerState.state.value;
  if (context.systemPrompt?.trim()) body.system_instruction = context.systemPrompt.trim();

  const generationConfig: Record<string, unknown> = {};
  if (typeof options.temperature === 'number') generationConfig.temperature = options.temperature;
  if (typeof options.topP === 'number') generationConfig.top_p = options.topP;
  const maxTokens = options.maxTokens ?? model.maxTokens;
  if (typeof maxTokens === 'number' && maxTokens > 0) {
    generationConfig.max_output_tokens = maxTokens;
  }
  applyGoogleInteractionsReasoning(
    generationConfig,
    options.reasoning,
    options.reasoningVisibility,
  );
  if (Object.keys(generationConfig).length > 0) body.generation_config = generationConfig;

  if (context.tools?.length) {
    body.tools = context.tools.map(toGoogleInteractionTool);
  }
  return body;
}

export function toGoogleInteractionSteps(
  messages: Context['messages'],
  requestPlan: RequestPlan,
): Record<string, unknown>[] {
  return messages.flatMap((message) => convertMessage(message, requestPlan));
}

function convertMessage(
  message: Message,
  requestPlan: RequestPlan,
): Record<string, unknown>[] {
  if (message.role === 'user') {
    return [{
      type: 'user_input',
      content: toInteractionContent(message.content),
    }];
  }
  if (message.role === 'toolResult') {
    return [{
      type: 'function_result',
      call_id: message.toolCallId,
      name: message.toolName,
      result: toInteractionContent(message.content),
      ...(message.isError ? { is_error: true } : {}),
    }];
  }

  const sameToolLoop = message.content.some((block) => block.type === 'toolCall');
  return message.content.flatMap((block): Record<string, unknown>[] => {
    if (block.type === 'text') {
      return [{
        type: 'model_output',
        content: [{ type: 'text', text: block.text }],
      }];
    }
    if (block.type === 'toolCall') {
      return [{
        type: 'function_call',
        id: block.id,
        name: block.name,
        arguments: block.arguments ?? {},
      }];
    }
    const decision = decideContinuationReplay(
      block.continuation,
      requestPlan,
      { sameToolLoop },
    );
    if (decision.action !== 'replay' || !block.continuation?.raw) return [];
    return [cloneJsonRecord(block.continuation.raw)];
  });
}

function toInteractionContent(
  content: string | Array<{ type: string; text?: string; data?: string; mimeType?: string }>,
): Record<string, unknown>[] {
  if (typeof content === 'string') return [{ type: 'text', text: content }];
  return content.map((block) => {
    if (block.type === 'text') return { type: 'text', text: block.text ?? '' };
    if (block.type === 'image' && block.data && block.mimeType) {
      return { type: 'image', data: block.data, mime_type: block.mimeType };
    }
    throw new Error(`Google Interactions cannot encode content block ${block.type}.`);
  });
}

function toGoogleInteractionTool(tool: ToolDefinition): Record<string, unknown> {
  return {
    type: 'function',
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  };
}

function cloneJsonRecord(value: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}
