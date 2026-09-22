// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { SessionRightRail } from './SessionRightRail';

const state = vi.hoisted(() => ({ tracePresentation: null as null | { rightPanel: Record<string, unknown> } }));
vi.mock('../../stores/workflowStore', () => ({ useWorkflowStore: (select: (value: typeof state) => unknown) => select(state) }));
vi.mock('../../i18n', () => ({ useI18n: () => ({ t: (key: string) => key, language: 'en' }) }));

describe('session rail projection composition', () => {
  it('retains five card shells through empty, populated, degraded and cleared projections', () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const host = document.createElement('div'); const root = createRoot(host);
    const render = () => act(() => root.render(createElement(SessionRightRail)));
    const ids = () => [...host.querySelectorAll('section[data-testid]')].map((node) => node.getAttribute('data-testid'));
    const expected = ['progress', 'artifacts', 'outputs', 'context', 'capture'].map((id) => `right-rail-${id}`);
    try {
      state.tracePresentation = null; render();
      expect(ids()).toEqual(expected);
      expect(host.querySelectorAll('[aria-expanded]')).toHaveLength(0);
      state.tracePresentation = { rightPanel: {
        progress: [{ id: 'task', sessionId: 'session', order: 1, title: 'A blocked task', status: 'blocked', blockerSummary: 'Needs input' }],
        artifacts: { rows: [], storeDegraded: true, supersededCount: 0, truncatedCount: 0 },
        outputs: { current: [{ id: 'output', displayName: 'A long output name', path: '/output', status: 'failed' }], previous: [] },
        context: { task: { resources: [{ id: 'resource', kind: 'skill', label: 'A loaded skill', summary: 'Scope retained' }] } },
      } }; render();
      expect(ids()).toEqual(expected);
      expect(host.textContent).toContain('A blocked task');
      expect(host.textContent).toContain('Needs input');
      expect(host.textContent).toContain('control.rightRail.artifacts.storeDegraded');
      expect(host.textContent).toContain('A loaded skill');
      const missing = [...host.querySelectorAll('button')].find((button) => button.textContent === 'control.rightRail.outputs.missing');
      expect(missing?.disabled).toBe(true);
      state.tracePresentation = null; render();
      expect(ids()).toEqual(expected);
      expect(host.textContent).not.toContain('A blocked task');
      expect(host.textContent).not.toContain('A loaded skill');
    } finally { act(() => root.unmount()); state.tracePresentation = null; }
  });
});
