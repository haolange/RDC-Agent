import { ProviderTimeoutError, type ProviderTimeoutPhase } from './http';
import type { RequestPlan } from '@shared/types/providerCapability';

/** Silence tolerated before the first byte of a request that does not reason first (connect, headers, first chunk). */
export const DEFAULT_PROVIDER_FIRST_CHUNK_TIMEOUT_MS = 20_000;
/** First-byte allowance for a request that may think before it emits anything. */
export const REASONING_PROVIDER_FIRST_CHUNK_TIMEOUT_MS = 180_000;
/** Silence tolerated between two chunks once the stream has started. */
export const DEFAULT_PROVIDER_STREAM_IDLE_TIMEOUT_MS = 60_000;

export interface ProviderStreamTimeoutOptions {
  firstChunkTimeoutMs?: number;
  streamIdleTimeoutMs?: number;
}

/**
 * The first-byte allowance for a request: short when the plan sends no reasoning (the model answers or fails fast),
 * long when it may reason, since a reasoning model can be silent for minutes before its first chunk.
 */
export function providerFirstByteTimeoutMs(plan: Pick<RequestPlan, 'reasoningWire'>): number {
  const { selection, control } = plan.reasoningWire;
  return control.kind === 'none' || selection === 'off'
    ? DEFAULT_PROVIDER_FIRST_CHUNK_TIMEOUT_MS
    : REASONING_PROVIDER_FIRST_CHUNK_TIMEOUT_MS;
}

export interface StreamWatchdogInput extends ProviderStreamTimeoutOptions {
  providerApi: string;
  /** Aborts the request with the timeout as the abort reason. */
  abort: (reason: ProviderTimeoutError) => void;
  /** Whether the stream has produced model output yet; carried on the timeout so recovery can tell. */
  hasOutput: () => boolean;
}

/**
 * The single timer of one provider stream. The first-byte timer runs from request dispatch, so connecting, waiting
 * for response headers and waiting for the first chunk share one allowance; every received chunk or part calls
 * `touch()`, which switches to and re-arms the idle timer. There is no total limit while progress continues.
 */
export class StreamWatchdog {
  private readonly input: StreamWatchdogInput;
  private readonly firstChunkTimeoutMs: number;
  private readonly streamIdleTimeoutMs: number;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private phase: ProviderTimeoutPhase = 'first-byte';
  private stopped = false;

  constructor(input: StreamWatchdogInput) {
    this.input = input;
    this.firstChunkTimeoutMs = input.firstChunkTimeoutMs ?? DEFAULT_PROVIDER_FIRST_CHUNK_TIMEOUT_MS;
    this.streamIdleTimeoutMs = input.streamIdleTimeoutMs ?? DEFAULT_PROVIDER_STREAM_IDLE_TIMEOUT_MS;
  }

  /** Arms the first-byte timer; call when the request is dispatched. */
  start(): void {
    this.arm(this.firstChunkTimeoutMs);
  }

  /** A chunk or part arrived: the stream is alive, so the next silence is measured as idle. */
  touch(): void {
    if (this.stopped) return;
    this.phase = 'idle';
    this.arm(this.streamIdleTimeoutMs);
  }

  dispose(): void {
    this.stopped = true;
    this.clear();
  }

  private arm(timeoutMs: number): void {
    this.clear();
    if (this.stopped || !Number.isFinite(timeoutMs) || timeoutMs <= 0) return;
    const phase = this.phase;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.input.abort(new ProviderTimeoutError(this.input.providerApi, phase, timeoutMs, this.input.hasOutput()));
    }, timeoutMs);
  }

  private clear(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
