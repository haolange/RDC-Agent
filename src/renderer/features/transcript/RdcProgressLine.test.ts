// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useToolProgressStore } from '../../stores/toolProgressStore';
import { RdcProgressLine } from './RdcProgressLine';
import type { AgentEvent, RdcOperationProgress } from '@shared/types/agentRuntime';

vi.mock('../../i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, unknown>) => (params ? `${key}${JSON.stringify(params)}` : key),
    language: 'en',
  }),
}));

const NOW = 1_000_000;
const progress = (patch: Partial<RdcOperationProgress> = {}): RdcOperationProgress => ({
  operation: 'rd.capture.open_file',
  state: 'running',
  stage: 'capture_transfer_progress',
  progressPct: 40,
  nativeCall: 'OpenCapture',
  startedAt: NOW - 60_000,
  lastProgressAt: NOW,
  ...patch,
});
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const render = (value: RdcOperationProgress) => {
  act(() => root.render(createElement(RdcProgressLine, { progress: value })));
  return host.textContent;
};

it('names the stage and its share in human words, never the raw stage or native call', () => {
  expect(render(progress())).toBe('chat.rdcProgressTransferring · 40%');
  expect(render(progress({ stage: 'decode_texture_readback', progressPct: null }))).toBe('chat.rdcProgressWorking');
  expect(render(progress({ state: 'queued', lastProgressAt: NOW - 120_000 }))).toBe('chat.rdcProgressQueued');
  expect(host.textContent).not.toMatch(/OpenCapture|rd\.capture|decode_texture/u);
});

it('says how long a running operation has been quiet once it passes 30 s, and keeps counting', () => {
  expect(render(progress({ lastProgressAt: NOW - 29_000 }))).not.toContain('chat.rdcProgressQuiet');
  act(() => vi.advanceTimersByTime(1_000));
  expect(host.textContent).toBe('chat.rdcProgressTransferring · 40% · chat.rdcProgressQuiet{"seconds":30}');
  act(() => vi.advanceTimersByTime(15_000));
  expect(host.textContent).toContain('chat.rdcProgressQuiet{"seconds":45}');
});

it('keeps progress only for calls that are still running', () => {
  const event = (type: string, payload: Record<string, unknown>) =>
    ({ id: type, type, timestamp: 1, payload }) as unknown as AgentEvent;
  const store = useToolProgressStore.getState();
  store.apply(event('tool.progress', { toolCallId: 'a', toolName: 'shell', progress: progress() }));
  store.apply(
    event('tool.progress', { toolCallId: 'b', toolName: 'shell', progress: progress({ stage: 'checking' }) }),
  );
  store.apply(event('tool.completed', { toolCallId: 'a', toolName: 'shell', result: {} }));
  expect(Object.keys(useToolProgressStore.getState().byToolCall)).toEqual(['b']);
  store.apply(event('run.cancelled', { status: 'cancelled' }));
  expect(useToolProgressStore.getState().byToolCall).toEqual({});
});
