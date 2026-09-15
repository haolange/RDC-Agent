import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { CaptureReplayState } from '@shared/types/captureReplay';
import { acceptsReplayState } from './useCaptureReplay';
import { CaptureFrame } from './CaptureFrame';
import { collectCaptureCallouts, resolveCaptureStatusTone } from './CaptureReplayStatus';

const scope = { projectId: 'project', sessionId: 'session' };
const replay: CaptureReplayState = { ...scope, generation: 3, operationId: null, revision: 8, phase: 'ready', inputId: 'input', captureHash: 'hash', contextId: 'context', replayDeviceId: 'local', requestedEventId: 42, appliedEventId: 42, imageEventId: 21, events: [{ eventId: 21 }, { eventId: 42 }], targets: [], target: null, isFinalOutput: false, image: null, devicePresentation: { status: 'not_applicable' }, interactionLock: null, error: null, warning: null, observation: null, agentObservation: null };
describe('capture scoped projection', () => {
  it('rejects other scopes and stale generation or revision', () => {
    expect(acceptsReplayState(replay, { ...replay, sessionId: 'other' }, scope)).toBe(false);
    expect(acceptsReplayState(replay, { ...replay, generation: 2, revision: 100 }, scope)).toBe(false);
    expect(acceptsReplayState(replay, { ...replay, revision: 7 }, scope)).toBe(false);
    expect(acceptsReplayState(replay, { ...replay, generation: 4, revision: 0 }, scope)).toBe(true);
  });
  it('labels requested and displayed events separately and disables live mutation when locked', () => {
    const html = renderToStaticMarkup(createElement(CaptureFrame, { scope, state: replay, disabled: true, receive: vi.fn() }));
    expect(html).toContain('42');
    expect(html).toMatch(/type="range"[^>]*disabled/);
    expect(html).not.toContain('<img');
  });
  it('reports completion when an applied event has no color output', () => {
    const state = { ...replay, imageEventId: null, image: null, error: { code: 'no_color_output', message: 'No color output', retry: null } };
    const html = renderToStaticMarkup(createElement(CaptureFrame, { scope, state, disabled: false, receive: vi.fn() }));
    expect(html).toContain('42');
    expect(html).not.toContain('正在应用');
    expect(html).not.toContain('Applying EID');
  });
  it('keeps partial ready on warning tone and does not treat no-color output as an error callout', () => {
    expect(resolveCaptureStatusTone({ phase: 'ready', pending: false, partial: true })).toBe('warning');
    expect(resolveCaptureStatusTone({ phase: 'error', pending: false, partial: false })).toBe('error');
    expect(resolveCaptureStatusTone({ phase: 'ready', pending: false, partial: false })).toBe('success');
    const callouts = collectCaptureCallouts({
      locked: false,
      lockedLabel: 'locked',
      warning: { code: 'final_output_unavailable', message: 'Final Present does not identify exactly one swap-buffer resource' },
      finalPresentTitle: 'Final Present is not uniquely identified',
      actionError: null,
      connectionError: null,
      stateError: { code: 'no_color_output', message: 'No color output', retry: null },
      factLabels: { no_color_output: 'No image for this event', missing_target: 'missing', export_failure: 'export failed' },
    });
    expect(callouts).toEqual([
      expect.objectContaining({
        tone: 'warning',
        title: 'Final Present is not uniquely identified',
        detail: 'Final Present does not identify exactly one swap-buffer resource',
      }),
    ]);
    expect(callouts.some((item) => item.tone === 'error')).toBe(false);
  });
});
