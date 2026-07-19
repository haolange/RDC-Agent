import type { RequestPlan } from '@shared/types/providerCapability';
import { createContinuationArtifact } from '../reasoning/ContinuationArtifacts';
import {
  AssistantStreamBuilder,
  createProviderOutputRef,
} from './internal/AssistantStreamBuilder';
import { ProviderHttpError } from './internal/http';
import { reasoningProjectionSource } from './reasoningProjection';

const PROVIDER_API = 'google-interactions';

interface ActiveStep {
  type: 'model_output' | 'thought' | 'function_call';
  ref: ReturnType<typeof createProviderOutputRef>;
  raw: Record<string, unknown>;
  summary: Record<string, unknown>[];
  signature?: string;
}

export class GoogleInteractionsStepState {
  private readonly active = new Map<number, ActiveStep>();
  private sawOutput = false;
  private sawToolCall = false;

  constructor(
    private readonly builder: AssistantStreamBuilder,
    private readonly requestPlan: RequestPlan,
    private readonly interactionId: () => string | undefined,
  ) {}

  start(index: number | null, step: Record<string, unknown> | null): void {
    if (index === null || !step || this.active.has(index)) {
      throw new ProviderHttpError(PROVIDER_API, 502, 'Invalid or duplicate Google Interactions step.start.');
    }
    const type = stringValue(step.type);
    if (type !== 'model_output' && type !== 'thought' && type !== 'function_call') {
      throw new ProviderHttpError(
        PROVIDER_API,
        502,
        `Unsupported Google Interactions step type: ${type || 'unknown'}.`,
      );
    }
    const ref = createProviderOutputRef({
      protocol: PROVIDER_API,
      responseId: this.interactionId(),
      providerBlockKey: `step:${index}`,
      sourceIndex: index,
      itemId: stringValue(step.id) || undefined,
      contentIndex: index,
    });
    const active: ActiveStep = {
      type,
      ref,
      raw: cloneRecord(step),
      summary: recordsValue(step.summary),
      signature: stringValue(step.signature) || undefined,
    };
    this.active.set(index, active);
    this.sawOutput = true;

    if (type === 'model_output') {
      this.builder.startText(ref);
      for (const content of recordsValue(step.content)) this.appendOutputContent(active, content);
    } else if (type === 'function_call') {
      this.sawToolCall = true;
      this.builder.startToolCall(ref, stringValue(step.id), stringValue(step.name));
      const initialArguments = step.arguments;
      if (initialArguments !== undefined) {
        this.builder.appendToolCallArgs(
          ref,
          typeof initialArguments === 'string' ? initialArguments : JSON.stringify(initialArguments),
        );
      }
    } else {
      const continuation = this.thoughtArtifact(active);
      const summaryText = active.summary.map((item) => stringValue(item.text)).join('');
      this.builder.startThinking(ref, summaryText
        ? {
            kind: 'summary',
            source: reasoningProjectionSource(this.requestPlan, 'summary'),
            visibility: 'summary',
            continuation,
          }
        : {
            kind: 'opaque',
            source: reasoningProjectionSource(this.requestPlan, 'opaque'),
            visibility: 'hidden',
            continuation,
          });
      if (summaryText) this.builder.appendThinking(ref, summaryText, { continuation });
    }
  }

  delta(index: number | null, delta: Record<string, unknown> | null): void {
    const active = index === null ? undefined : this.active.get(index);
    if (!active || !delta) {
      throw new ProviderHttpError(
        PROVIDER_API,
        502,
        'Google Interactions emitted step.delta before step.start.',
      );
    }
    const type = stringValue(delta.type);
    if (type === 'text' && active.type === 'model_output') {
      this.builder.appendText(active.ref, stringValue(delta.text));
    } else if (type === 'arguments_delta' && active.type === 'function_call') {
      this.builder.appendToolCallArgs(active.ref, stringValue(delta.arguments));
    } else if (type === 'thought_summary' && active.type === 'thought') {
      const content = recordValue(delta.content);
      if (!content) {
        throw new ProviderHttpError(PROVIDER_API, 502, 'Google Interactions emitted an invalid thought summary.');
      }
      active.summary.push(cloneRecord(content));
      active.raw.summary = active.summary.map(cloneRecord);
      if (stringValue(content.type) === 'text') {
        this.builder.appendThinking(active.ref, stringValue(content.text), {
          kind: 'summary',
          source: reasoningProjectionSource(this.requestPlan, 'summary'),
          visibility: 'summary',
          continuation: this.thoughtArtifact(active),
        });
      } else {
        this.builder.updateThinking(active.ref, { continuation: this.thoughtArtifact(active) });
      }
    } else if (type === 'thought_signature' && active.type === 'thought') {
      active.signature = stringValue(delta.signature) || undefined;
      if (active.signature) active.raw.signature = active.signature;
      this.builder.updateThinking(active.ref, { continuation: this.thoughtArtifact(active) });
    }
  }

  stop(index: number | null): void {
    const active = index === null ? undefined : this.active.get(index);
    if (!active) {
      throw new ProviderHttpError(PROVIDER_API, 502, 'Google Interactions emitted step.stop before step.start.');
    }
    if (active.type === 'model_output') this.builder.endText(active.ref);
    else if (active.type === 'function_call') this.builder.endToolCall(active.ref);
    else {
      if (!active.signature) {
        throw new ProviderHttpError(
          PROVIDER_API,
          502,
          'Google Interactions thought step ended without its required signature.',
        );
      }
      this.builder.endThinking(active.ref, { continuation: this.thoughtArtifact(active) });
    }
    this.active.delete(index!);
  }

  hasOpenSteps(): boolean {
    return this.active.size > 0;
  }

  outputSeen(): boolean {
    return this.sawOutput;
  }

  toolCallSeen(): boolean {
    return this.sawToolCall;
  }

  private appendOutputContent(active: ActiveStep, content: Record<string, unknown>): void {
    if (stringValue(content.type) !== 'text') {
      throw new ProviderHttpError(PROVIDER_API, 502, 'Google Interactions returned unsupported model output content.');
    }
    this.builder.appendText(active.ref, stringValue(content.text));
  }

  private thoughtArtifact(active: ActiveStep) {
    if (!active.signature) return undefined;
    active.raw.type = 'thought';
    active.raw.signature = active.signature;
    active.raw.summary = active.summary.map(cloneRecord);
    return createContinuationArtifact(this.requestPlan, {
      type: 'thought',
      signature: active.signature,
      raw: cloneRecord(active.raw),
    });
  }
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
function recordsValue(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.map(recordValue).filter((item): item is Record<string, unknown> => Boolean(item))
    : [];
}
function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
function cloneRecord(value: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}
