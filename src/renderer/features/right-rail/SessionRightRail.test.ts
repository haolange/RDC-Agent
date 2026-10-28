// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { TASK_STATUS_REASONS } from '@shared/constants/taskStatusReasons';
import { enControl } from '../../i18n/locales/en/control';
import { zhControl } from '../../i18n/locales/zh-CN/control';
import { SessionRightRail } from './SessionRightRail';

const state = vi.hoisted(() => ({ tracePresentation: null as null | { rightPanel: Record<string, unknown> } }));
vi.mock('../../stores/workflowStore', () => ({ useWorkflowStore: (select: (value: typeof state) => unknown) => select(state) }));
vi.mock('../../i18n', () => ({ useI18n: () => ({ t: (key: string, values?: { done: number; total: number }) => values ? `${key}:${values.done}/${values.total}` : key, language: 'en' }) }));

describe('session rail projection composition', () => {
  it('keeps task numbers independent of state and hides reasons from the compact list', () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const host = document.createElement('div'); const root = createRoot(host);
    try {
      state.tracePresentation = { rightPanel: {
        progress: [
          { id: 'started', sessionId: 'session', order: 0, title: 'Started', status: 'cancelled', blockerSummary: TASK_STATUS_REASONS.parentTurnStopped },
          { id: 'pending', sessionId: 'session', order: 1, title: 'Pending', status: 'cancelled', blockerSummary: TASK_STATUS_REASONS.createdTurnStopped },
          { id: 'custom', sessionId: 'session', order: 2, title: 'Custom', status: 'blocked', blockerSummary: '等待用户确认' },
        ],
      } };
      act(() => root.render(createElement(SessionRightRail)));
      expect(host.textContent).not.toContain('control.rightRail.progress.reason.parentTurnStopped');
      expect(host.textContent).not.toContain('control.rightRail.progress.reason.createdTurnStopped');
      expect(host.textContent).not.toContain('等待用户确认');
      expect([...host.querySelectorAll('.right-rail-task-order')].map(el => el.textContent)).toEqual(['1','2','3']);
      expect(host.querySelectorAll('.right-rail-task-row .task-status-marker')).toHaveLength(3);
      expect(zhControl['control.rightRail.progress.reason.parentTurnStopped']).toBe('主回合停止，所属执行已结束。');
      expect(zhControl['control.rightRail.progress.reason.createdTurnStopped']).toBe('创建此待办的回合已停止，待办尚未开始。');
      expect(enControl['control.rightRail.progress.reason.parentTurnStopped']).toBe(TASK_STATUS_REASONS.parentTurnStopped);
      expect(enControl['control.rightRail.progress.reason.createdTurnStopped']).toBe(TASK_STATUS_REASONS.createdTurnStopped);
    } finally { act(() => root.unmount()); state.tracePresentation = null; host.remove(); }
  });

  it('shows progress count from the current projection and removes populated density when cleared', () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const host = document.createElement('div'); const root = createRoot(host);
    try {
      state.tracePresentation = { rightPanel: { progress: [
        { id: 'done', sessionId: 'session', order: 0, title: 'Complete title retained', status: 'completed' },
        { id: 'live', sessionId: 'session', order: 1, title: 'Live', status: 'in_progress' },
        { id: 'cancelled', sessionId: 'session', order: 2, title: 'Cancelled', status: 'cancelled' },
      ] } };
      act(() => root.render(createElement(SessionRightRail)));
      const progress = host.querySelector('[data-testid="right-rail-progress"]')!;
      expect(progress.classList.contains('is-populated')).toBe(true);
      expect(progress.querySelector('.right-rail-section-meta')?.textContent).toBe('control.traceProgressCount:1/3');
      expect(host.querySelectorAll('.right-rail-section.is-populated')).toHaveLength(1);
      expect(progress.textContent).toContain('Complete title retained');
      const title = progress.querySelector<HTMLElement>('.right-rail-task-copy .ui-overflow-fade')!;
      expect(title.textContent).toBe('Complete title retained');
      expect(title.title).toBe('Complete title retained');
      state.tracePresentation = null;
      act(() => root.render(createElement(SessionRightRail)));
      expect(progress.classList.contains('is-populated')).toBe(false);
      expect(progress.querySelector('.right-rail-section-meta')).toBeNull();
    } finally { act(() => root.unmount()); state.tracePresentation = null; host.remove(); }
  });

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
        artifacts: { rows: [], storeDegraded: true, totalCount: 0 },
        outputs: { current: [{ id: 'output', displayName: 'A long output name', path: '/output', status: 'failed' }], previous: [] },
        context: { task: { resources: [{ id: 'resource', kind: 'skill', label: 'A loaded skill', summary: 'Scope retained' }] } },
      } }; render();
      expect(ids()).toEqual(expected);
      expect(host.textContent).toContain('A blocked task');
      expect(host.textContent).not.toContain('Needs input');
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
