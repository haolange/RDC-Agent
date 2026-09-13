import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { CaptureReplayState } from '@shared/types/captureReplay';
import { acceptsReplayState } from './useCaptureReplay';
import { CaptureFrame } from './CaptureFrame';

const scope = { projectId: 'project', sessionId: 'session' };
const replay: CaptureReplayState = { ...scope, generation: 3, operationId: null, revision: 8, phase: 'ready', inputId: 'input', captureHash: 'hash', contextId: 'context', replayDeviceId: 'local', requestedEventId: 42, appliedEventId: 42, imageEventId: 21, events: [{ eventId: 21, name: 'clear' }, { eventId: 42, name: 'draw' }], targets: [], target: null, isFinalOutput: false, image: null, devicePresentation: { status: 'not_applicable' }, interactionLock: null, error: null, warning: null, observation: null, agentObservation: null };
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
});
