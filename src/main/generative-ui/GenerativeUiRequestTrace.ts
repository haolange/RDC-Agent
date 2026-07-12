import type { LLMResponse, LLMRequest } from '@shared/types/llm';
import type { PromptPlan } from '@shared/types/rdxRuntime';
import { generateEventId } from '@shared/utils/id';
import { charsToTokens } from '@shared/utils/tokens';
import { hashScopedResource } from '../runtime/ScopedResourceResolver';
import { requestEnvelopeBuilder, requestSnapshotStore } from '../agent-runtime/prompt';
import type { RequestSnapshotStore } from '../agent-runtime/prompt/RequestSnapshotStore';
import type { GenerativeUiModelCallContext } from './GenerativeUiModelContracts';

export class GenerativeUiRequestTrace {
  constructor(private readonly snapshots: RequestSnapshotStore = requestSnapshotStore) {}

  begin(systemPrompt: string, request: LLMRequest, route: { providerId: string; modelId: string; protocol: string }, context?: GenerativeUiModelCallContext): string | null {
    if (!context) return null;
    const promptPlan: PromptPlan = {
      id: generateEventId('prompt-plan'),
      segments: [{
        id: 'generative-ui:system', kind: 'core-contract', scope: 'builtin', sourcePath: 'runtime://generative-ui/system',
        sourceHash: hashScopedResource(systemPrompt), precedence: 0, content: systemPrompt, tokenEstimate: charsToTokens(systemPrompt.length),
      }],
      systemPrompt, totalTokenEstimate: charsToTokens(systemPrompt.length),
      metrics: { systemPrompt: systemPrompt.length, scopedInstructions: 0, skills: 0 }, diagnostics: [],
    };
    const snapshot = requestEnvelopeBuilder.build({
      promptPlan, sessionId: context.sessionId, turnId: context.turnId,
      callIndex: this.snapshots.nextCallIndex(context.sessionId, context.turnId), route,
      messages: request.messages, tools: [], controls: { phase: context.phase, temperature: request.temperature, maxTokens: request.maxTokens, responseFormat: request.responseFormat },
      reasoning: { semantic: 'none', source: 'generative-ui', displayLabel: 'None' },
    });
    this.snapshots.write(snapshot);
    return snapshot.id;
  }

  complete(snapshotId: string | null, response: LLMResponse, context?: GenerativeUiModelCallContext): void {
    if (!snapshotId || !context) return;
    this.snapshots.complete(snapshotId, context.sessionId, context.turnId, {
      inputTokens: response.usage.inputTokens, outputTokens: response.usage.outputTokens, estimated: false,
    });
  }
}

export const generativeUiRequestTrace = new GenerativeUiRequestTrace();
