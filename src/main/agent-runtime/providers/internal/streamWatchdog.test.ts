import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTestRequestPlan } from '../../../testing/createTestRequestPlan';
import { ProviderTimeoutError } from './http';
import {
  DEFAULT_PROVIDER_FIRST_CHUNK_TIMEOUT_MS,
  providerFirstByteTimeoutMs,
  REASONING_PROVIDER_FIRST_CHUNK_TIMEOUT_MS,
  StreamWatchdog,
} from './streamWatchdog';
import type { RequestPlan } from '@shared/types/providerCapability';
import type { ReasoningControl, ResolvedReasoningSelection } from '@shared/types/modelCapability';

function planWith(reasoningWire: ResolvedReasoningSelection): RequestPlan {
  return createTestRequestPlan({
    providerId: 'fixture',
    adapterId: 'openai-compatible',
    catalogRevision: 'fixture',
    routeRevision: 'fixture',
    selectedModelId: 'm',
    effectiveModelId: 'm',
    appliedBindingIds: [],
    route: { protocol: 'OpenAICompatibleChatCompletions', baseUrl: 'https://provider.fixture', source: 'catalog' },
    headers: {},
    bodyPatch: {},
    contextBudgetTokens: 128_000,
    contextMode: 'normal',
    contextWindowTokens: 128_000,
    activeTierId: 'default',
    fastMode: false,
    reasoningWire,
  } as never);
}

const control = (kind: ReasoningControl['kind'], supportsOff = true): ReasoningControl => ({
  kind,
  supportsOff,
  levels: kind === 'levels' ? ['low', 'high'] : [],
  defaultSelection: 'off',
  wireProfile: { kind: 'none' },
});

describe('providerFirstByteTimeoutMs', () => {
  it('is short for a model without reasoning control', () => {
    expect(providerFirstByteTimeoutMs(planWith({ selection: 'on', control: control('none') }))).toBe(20_000);
  });

  it('is short when the selection turns reasoning off', () => {
    expect(providerFirstByteTimeoutMs(planWith({ selection: 'off', control: control('toggle') }))).toBe(
      DEFAULT_PROVIDER_FIRST_CHUNK_TIMEOUT_MS,
    );
  });

  it('is long when the model may reason before its first chunk', () => {
    expect(providerFirstByteTimeoutMs(planWith({ selection: 'high', control: control('levels') }))).toBe(180_000);
    expect(providerFirstByteTimeoutMs(planWith({ selection: 'on', control: control('always-on', false) }))).toBe(
      REASONING_PROVIDER_FIRST_CHUNK_TIMEOUT_MS,
    );
    expect(providerFirstByteTimeoutMs(planWith({ selection: 'unknown', control: control('unknown') }))).toBe(180_000);
  });
});

describe('StreamWatchdog', () => {
  afterEach(() => vi.useRealTimers());

  function watchdog(hasOutput = () => false) {
    vi.useFakeTimers();
    const abort = vi.fn<(reason: ProviderTimeoutError) => void>();
    const dog = new StreamWatchdog({
      providerApi: 'fixture',
      firstChunkTimeoutMs: 100,
      streamIdleTimeoutMs: 50,
      abort,
      hasOutput,
    });
    return { dog, abort };
  }

  it('times the first byte from dispatch, covering a slow connect or slow response headers', () => {
    const { dog, abort } = watchdog();
    dog.start();

    vi.advanceTimersByTime(99);
    expect(abort).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);

    expect(abort).toHaveBeenCalledTimes(1);
    expect(abort.mock.calls[0]![0]).toMatchObject({ phase: 'first-byte', timeoutMs: 100, afterContent: false });
  });

  it('re-arms the idle timer on every chunk, so a stream that keeps progressing is never cut by a total limit', () => {
    const { dog, abort } = watchdog();
    dog.start();
    vi.advanceTimersByTime(90);
    dog.touch();
    for (let i = 0; i < 1000; i += 1) {
      vi.advanceTimersByTime(49);
      dog.touch();
    }
    expect(abort).not.toHaveBeenCalled();

    vi.advanceTimersByTime(50);
    expect(abort.mock.calls[0]![0]).toMatchObject({ phase: 'idle', timeoutMs: 50 });
  });

  it('records whether output had been produced when it fired', () => {
    let output = false;
    const { dog, abort } = watchdog(() => output);
    dog.start();
    dog.touch();
    output = true;
    vi.advanceTimersByTime(50);

    expect(abort.mock.calls[0]![0].afterContent).toBe(true);
  });

  it('stays silent after dispose', () => {
    const { dog, abort } = watchdog();
    dog.start();
    dog.dispose();
    dog.touch();
    vi.advanceTimersByTime(10_000);
    expect(abort).not.toHaveBeenCalled();
  });
});
