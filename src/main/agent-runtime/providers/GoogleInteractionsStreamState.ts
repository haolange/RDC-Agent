import type { RequestPlan } from '@shared/types/providerCapability';
import type { StopReason } from '../core/types';
import { createProviderStateRef } from '../reasoning/ProviderStateRefs';
import {
  AssistantStreamBuilder,
  createProviderOutputRef,
  ProviderStreamProtocolError,
} from './internal/AssistantStreamBuilder';
import { ProviderHttpError } from './internal/http';
import { GoogleInteractionsStepState } from './GoogleInteractionsStepState';

const PROVIDER_API = 'google-interactions';

export interface GoogleInteractionsOutcome {
  terminalSeen: boolean;
  sawOutput: boolean;
  finishReason: StopReason;
}

export class GoogleInteractionsStreamState {
  private readonly terminalRef = createProviderOutputRef({
    protocol: PROVIDER_API,
    providerBlockKey: 'interaction:terminal',
    contentIndex: 1_000_000,
  });
  private readonly steps: GoogleInteractionsStepState;
  private interactionId: string | undefined;
  private terminalSeen = false;
  private finishReason: StopReason = 'stop';

  constructor(
    private readonly builder: AssistantStreamBuilder,
    private readonly requestPlan: RequestPlan,
  ) {
    this.steps = new GoogleInteractionsStepState(
      builder,
      requestPlan,
      () => this.interactionId,
    );
  }

  handle(event: Record<string, unknown>): void {
    const eventType = stringValue(event.event_type);
    if (this.terminalSeen) {
      throw new ProviderStreamProtocolError(
        'PROVIDER_STREAM_EVENT_AFTER_TERMINAL',
        this.terminalRef,
        `Google Interactions emitted ${eventType || 'an unknown event'} after terminal.`,
      );
    }
    if (eventType === 'interaction.created') {
      this.captureInteractionId(recordValue(event.interaction));
    } else if (eventType === 'step.start') {
      this.steps.start(integerValue(event.index), recordValue(event.step));
    } else if (eventType === 'step.delta') {
      this.steps.delta(integerValue(event.index), recordValue(event.delta));
    } else if (eventType === 'step.stop') {
      this.steps.stop(integerValue(event.index));
    } else if (eventType === 'interaction.requires_action') {
      this.finishInteraction(recordValue(event.interaction), 'toolUse');
    } else if (eventType === 'interaction.completed') {
      this.finishInteraction(recordValue(event.interaction));
    } else if (eventType === 'interaction.incomplete') {
      this.finishInteraction(recordValue(event.interaction), 'length');
    } else if (eventType === 'interaction.failed' || eventType === 'error') {
      const error = recordValue(event.error);
      throw new ProviderHttpError(
        PROVIDER_API,
        502,
        stringValue(error?.message) || 'Google Interactions request failed.',
      );
    } else if (eventType === 'interaction.cancelled') {
      throw Object.assign(new Error('Google Interactions request was cancelled.'), { name: 'AbortError' });
    }
  }

  outcome(): GoogleInteractionsOutcome {
    return {
      terminalSeen: this.terminalSeen,
      sawOutput: this.steps.outputSeen(),
      finishReason: this.finishReason,
    };
  }

  private finishInteraction(
    interaction: Record<string, unknown> | null,
    forcedReason?: StopReason,
  ): void {
    if (this.steps.hasOpenSteps()) {
      throw new ProviderHttpError(PROVIDER_API, 502, 'Google Interactions ended with open steps.');
    }
    this.captureInteractionId(interaction);
    const status = stringValue(interaction?.status);
    if (status === 'failed') {
      throw new ProviderHttpError(PROVIDER_API, 502, 'Google Interactions request failed.');
    }
    this.applyUsage(recordValue(interaction?.usage));
    const state = createProviderStateRef(this.requestPlan, this.interactionId);
    if (state) this.builder.setProviderState(state);
    this.finishReason = forcedReason
      ?? (status === 'incomplete' ? 'length' : this.steps.toolCallSeen() ? 'toolUse' : 'stop');
    this.terminalSeen = true;
  }

  private captureInteractionId(interaction: Record<string, unknown> | null): void {
    const id = stringValue(interaction?.id);
    if (!id) return;
    if (this.interactionId && this.interactionId !== id) {
      throw new ProviderHttpError(PROVIDER_API, 502, 'Google Interactions changed interaction id mid-stream.');
    }
    this.interactionId = id;
  }

  private applyUsage(usage: Record<string, unknown> | null): void {
    if (!usage) return;
    this.builder.setUsage({
      inputTokens: numberValue(usage.total_input_tokens) ?? 0,
      outputTokens: numberValue(usage.total_output_tokens) ?? 0,
      totalTokens: numberValue(usage.total_tokens) ?? 0,
      cacheReadTokens: numberValue(usage.total_cached_tokens) ?? 0,
      reasoningTokens: numberValue(usage.total_thought_tokens) ?? 0,
    });
  }
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
function integerValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}
