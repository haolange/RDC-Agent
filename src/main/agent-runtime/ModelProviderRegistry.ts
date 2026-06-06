import type { LLMRequest, LLMResponse, LLMStreamEvent, ToolCall } from '@shared/types/llm';
import type {
  ModelProviderBackendKind,
  ModelProviderCapabilityMatrix,
  ModelTurnEvent,
} from '@shared/types/agentRuntime';
import type { LlmProviderEntry, LlmProviderId, LlmProviderKind } from '@shared/types/settings';
import { getBuiltinProviderDefinition } from '@shared/constants/llm';
import { llmAdapter } from '../settings/LLMAdapter';
import { settingsService } from '../settings/SettingsService';

export interface ModelProviderTurnRequest {
  providerId: string;
  modelId: string;
  request: LLMRequest;
  onStreamEvent?: (event: LLMStreamEvent) => void;
  onModelTurnEvent?: (event: ModelTurnEvent) => void;
}

export class ModelProviderRegistry {
  listCapabilities(): ModelProviderCapabilityMatrix[] {
    return settingsService.getAll().llm.providers.map((provider) => this.getCapabilities(provider.id));
  }

  getCapabilities(providerId: string): ModelProviderCapabilityMatrix {
    const provider = this.resolveProvider(providerId);
    const kind = provider?.kind ?? getBuiltinProviderDefinition(providerId)?.kind ?? 'openai-compatible';
    const authMode = provider?.authMode ?? getBuiltinProviderDefinition(providerId)?.authMode ?? 'api-key';
    const backendKind = this.resolveBackendKind(providerId, kind, authMode);
    const toolCallFormat = this.resolveToolCallFormat(providerId, kind);
    const nativeToolCalling = toolCallFormat === 'openai-chat-completions';
    const structuredReliability = this.resolveStructuredReliability(providerId, kind);

    return {
      providerId: providerId as LlmProviderId,
      kind,
      authMode,
      backendKind,
      streaming: true,
      nativeToolCalling,
      structuredOutput: structuredReliability !== 'unsupported',
      vision: kind === 'google-ai-studio' || providerId.includes('openai') || providerId.includes('gpt'),
      reasoning: kind !== 'ollama',
      parallelToolCalls: false,
      oauth: authMode === 'account',
      local: authMode === 'local' || kind === 'ollama',
      toolCallFormat,
      structuredReliability,
    };
  }

  async streamTurn(input: ModelProviderTurnRequest): Promise<LLMResponse> {
    const emitModelEvent = input.onModelTurnEvent;
    emitModelEvent?.({
      providerId: input.providerId as LlmProviderId,
      modelId: input.modelId,
      type: 'started',
    });

    try {
      const response = await llmAdapter.streamChat(
        input.request,
        (event) => {
          input.onStreamEvent?.(event);
          const mapped = this.toModelTurnEvent(input.providerId, input.modelId, event);
          if (mapped) {
            emitModelEvent?.(mapped);
          }
        },
        input.providerId,
      );
      emitModelEvent?.({
        providerId: input.providerId as LlmProviderId,
        modelId: input.modelId,
        type: 'completed',
        text: typeof response.content === 'string' ? response.content : JSON.stringify(response.content),
        usage: response.usage,
      });
      return response;
    } catch (error) {
      emitModelEvent?.({
        providerId: input.providerId as LlmProviderId,
        modelId: input.modelId,
        type: 'failed',
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  private resolveProvider(providerId: string): LlmProviderEntry | null {
    try {
      return settingsService.getAll().llm.providers.find((provider) => provider.id === providerId) ?? null;
    } catch {
      return null;
    }
  }

  private resolveBackendKind(providerId: string, kind: LlmProviderKind, authMode: string): ModelProviderBackendKind {
    if (authMode === 'account' && (providerId === 'grok-account' || providerId === 'gemini-account' || providerId === 'qwen-account')) {
      return 'mockable-account';
    }
    if (authMode === 'local' || kind === 'ollama') {
      return 'local';
    }
    if (providerId === 'openai' || providerId === 'openai-us' || providerId === 'openai-eu' || kind === 'openai-compatible' || kind === 'openrouter' || kind === 'azure-openai') {
      return 'openai-compatible';
    }
    return 'native';
  }

  private resolveToolCallFormat(
    providerId: string,
    kind: LlmProviderKind,
  ): ModelProviderCapabilityMatrix['toolCallFormat'] {
    if (providerId === 'chatgpt-account') {
      return 'openai-responses';
    }
    if (kind === 'anthropic') {
      return 'anthropic-messages';
    }
    if (kind === 'google-ai-studio') {
      return 'google-gemini';
    }
    if (kind === 'openai-compatible' || kind === 'openrouter' || kind === 'azure-openai' || kind === 'ollama') {
      return 'openai-chat-completions';
    }
    return 'none';
  }

  private resolveStructuredReliability(
    providerId: string,
    kind: LlmProviderKind,
  ): ModelProviderCapabilityMatrix['structuredReliability'] {
    if (providerId === 'chatgpt-account' || kind === 'openai-compatible' || kind === 'openrouter' || kind === 'azure-openai') {
      return 'native';
    }
    if (kind === 'anthropic' || kind === 'google-ai-studio' || kind === 'ollama') {
      return 'prompted';
    }
    return 'unsupported';
  }

  private toModelTurnEvent(providerId: string, modelId: string, event: LLMStreamEvent): ModelTurnEvent | null {
    if (event.type === 'text-delta') {
      return {
        providerId: providerId as LlmProviderId,
        modelId,
        type: 'delta',
        text: event.text,
      };
    }
    if (event.type === 'tool-call-delta') {
      const toolCall: ToolCall = {
        id: event.toolCall.id,
        name: event.toolCall.name ?? '',
        arguments: event.toolCall.argumentsText ? { raw: event.toolCall.argumentsText } : {},
      };
      return {
        providerId: providerId as LlmProviderId,
        modelId,
        type: 'tool_call',
        toolCall,
      };
    }
    if (event.type === 'error') {
      return {
        providerId: providerId as LlmProviderId,
        modelId,
        type: 'failed',
        error: event.error,
      };
    }
    return null;
  }
}

export const modelProviderRegistry = new ModelProviderRegistry();
