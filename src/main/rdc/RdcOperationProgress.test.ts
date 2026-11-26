import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { translateCoreToSharedAgentEvent } from '../agent-runtime/AgentEventBridge';
import {
  createRdcProgressReporter,
  RDC_PROGRESS_UPDATE_INTERVAL_MS,
  type RdcProgressUpdate,
} from './RdcOperationProgress';

const heartbeat = (state: 'queued' | 'running') => ({ kind: 'heartbeat' as const, request_id: 'r', ts_ms: 1, state });
const progress = (stage: string) => ({
  kind: 'progress' as const,
  request_id: 'r',
  trace_id: 't',
  operation: 'rd.capture.open_file',
  stage,
  message: stage,
  progress_pct: 40,
  details: {},
  ts_ms: 1,
});
const nativeCall = (name: string) => ({
  kind: 'native_call' as const,
  request_id: 'r',
  trace_id: 't',
  name,
  phase: 'enter' as const,
  ts_ms: 1,
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(10_000);
});
afterEach(() => vi.useRealTimers());

it('reports the current state at most once a second, always delivering the last state before a pause', async () => {
  const updates: RdcProgressUpdate[] = [];
  const reporter = createRdcProgressReporter('rd.capture.open_file', (update) => updates.push(update));
  reporter.onFrame(heartbeat('queued'));
  expect(updates).toHaveLength(0);
  reporter.onFrame(heartbeat('running'));
  expect(updates.map((update) => update.progress.state)).toEqual(['running']);
  await vi.advanceTimersByTimeAsync(200);
  reporter.onFrame(progress('capture_transfer_progress'));
  reporter.onFrame(nativeCall('OpenCapture'));
  expect(updates).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(RDC_PROGRESS_UPDATE_INTERVAL_MS - 200);
  expect(updates).toHaveLength(2);
  expect(updates[1].progress).toEqual({
    operation: 'rd.capture.open_file',
    state: 'running',
    stage: 'capture_transfer_progress',
    progressPct: 40,
    nativeCall: 'OpenCapture',
    startedAt: 10_000,
    lastProgressAt: 10_200,
  });
  await vi.advanceTimersByTimeAsync(5_000);
  reporter.onFrame(heartbeat('running'));
  expect(updates).toHaveLength(2);
  reporter.onFrame(nativeCall('SetFrameEvent'));
  reporter.dispose();
  expect(updates.at(-1)?.progress.lastProgressAt).toBe(16_000);
  reporter.onFrame(nativeCall('Shutdown'));
  await vi.advanceTimersByTimeAsync(2_000);
  expect(updates).toHaveLength(3);
});

it('turns only RDC progress into the ephemeral tool.progress event', () => {
  const updates: RdcProgressUpdate[] = [];
  createRdcProgressReporter('rd.capture.open_file', (update) => updates.push(update)).onFrame(progress('walk'));
  const context = { agentId: 'general' as const, sessionId: 'session', turnId: 'turn' };
  const update = (partialResult: unknown) =>
    translateCoreToSharedAgentEvent(
      { type: 'tool_execution_update', toolCallId: 'call', toolName: 'shell', partialResult },
      context,
    );
  expect(update(updates[0])).toMatchObject({
    type: 'tool.progress',
    sessionId: 'session',
    payload: { toolCallId: 'call', toolName: 'shell', progress: { stage: 'walk', state: 'running' } },
  });
  expect(update({ content: [{ type: 'text', text: 'live shell output' }] })).toBeNull();
});
