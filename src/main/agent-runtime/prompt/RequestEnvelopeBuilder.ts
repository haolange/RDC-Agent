import { generateEventId } from '@shared/utils/id';
import type { PromptPlan, RequestEnvelopeSnapshot } from '@shared/types/rdxRuntime';
import type { RequestPlan } from '@shared/types/providerCapability';
import { redactSecretsDeep } from '../../runtime/secretRedaction';

export interface RequestEnvelopeInput {
  promptPlan: PromptPlan;
  sessionId?: string;
  turnId?: string;
  callIndex: number;
  route: { providerId: string; modelId: string; protocol: string };
  requestPlan: RequestPlan;
  messages: unknown[];
  mailboxDeliveries?: RequestEnvelopeSnapshot['mailboxDeliveries'];
  tools: unknown[];
  controls: Record<string, unknown>;
  reasoning: RequestEnvelopeSnapshot['reasoning'];
  cache: RequestEnvelopeSnapshot['cache'];
}

export class RequestEnvelopeBuilder {
  build(input: RequestEnvelopeInput): RequestEnvelopeSnapshot {
    const requestPlan = redactSecretsDeep(input.requestPlan, 'requestPlan');
    const promptPlan = redactSecretsDeep(input.promptPlan, 'promptPlan');
    const messages = redactSecretsDeep(input.messages, 'messages');
    const tools = redactSecretsDeep(input.tools, 'tools');
    const controls = redactSecretsDeep(input.controls, 'controls');
    const redactions = [
      ...requestPlan.redactions,
      ...promptPlan.redactions,
      ...messages.redactions,
      ...tools.redactions,
      ...controls.redactions,
    ];

    return {
      id: generateEventId('llm-call'),
      createdAt: new Date().toISOString(),
      sessionId: input.sessionId,
      turnId: input.turnId,
      callIndex: input.callIndex,
      route: input.route,
      requestPlan: requestPlan.value as unknown as RequestPlan,
      promptPlan: promptPlan.value as PromptPlan,
      messages: messages.value as unknown[],
      mailboxDeliveries: input.mailboxDeliveries,
      tools: tools.value as unknown[],
      controls: controls.value as Record<string, unknown>,
      reasoning: input.reasoning,
      cache: input.cache,
      redactions,
    };
  }
}

export const requestEnvelopeBuilder = new RequestEnvelopeBuilder();
