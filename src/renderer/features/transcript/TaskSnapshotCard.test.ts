// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { TaskSnapshotCard } from './TaskSnapshotCard';
import { ScopedWorkDisclosure } from './ScopedWorkDisclosure';
import { MeasuredWorkRows } from './MeasuredWorkRows';
import { createWorkProcessRowRenderer } from './workProcessRowRenderer';
import { WorkProcessContent } from './WorkProcessContent';
import type { WorkProcessRow } from './workProcessTypes';
import { WORK_PROCESS_LOCATE_TASK_EVENT, type WorkProcessTaskLocationRequest } from '../../lib/workProcessTaskLocation';

vi.mock('../../i18n', () => ({ useI18n: () => ({
  t: (key: string, values?: { completed: number; total: number }) => values
    ? `${values.completed} / ${values.total} completed` : key,
}) }));

const snapshot = (id: string, change?: 'created' | 'updated'): Extract<WorkProcessRow, { type: 'taskSnapshot' }> => ({
  type: 'taskSnapshot', id, change, status: 'complete', completed: 1, total: 5, duration: '0ms',
  items: [
    { taskId: 'pending', title: 'Long pending task with enough text to wrap on a narrow card', status: 'pending', order: 0 },
    { taskId: 'current', title: 'Current', status: 'in_progress', order: 1 },
    { taskId: 'done', title: 'Done', status: 'completed', order: 2 },
    { taskId: 'blocked', title: 'Blocked', status: 'blocked', statusReason: 'Waiting for input', order: 3 },
    { taskId: 'cancelled', title: 'Cancelled', status: 'cancelled', order: 4 },
  ],
});

it('shows event type, completion count and distinct state icons without a fake duration', () => {
  const html = renderToStaticMarkup(createElement(TaskSnapshotCard, { row: snapshot('new', 'created'), isLatest: true }));
  const document = new DOMParser().parseFromString(html, 'text/html');
  expect(document.body.textContent).toContain('chat.workProcessTaskSnapshotCreated');
  expect(document.body.textContent).toContain('1 / 5 completed');
  expect(document.body.textContent).not.toContain('0ms');
  expect(document.querySelectorAll('.task-status-marker.is-snapshot svg')).toHaveLength(5);
  expect(document.querySelector('.task-pending .task-status-marker circle')).not.toBeNull();
  expect(document.querySelector('.task-blocked .work-process-task-snapshot-reason')?.textContent).toBe('Waiting for input');
  expect(document.querySelector('[data-work-process-task-id="current"]')?.getAttribute('tabindex')).toBe('-1');
  const older = renderToStaticMarkup(createElement(TaskSnapshotCard, { row: snapshot('old'), isLatest: false }));
  expect(older).toContain('chat.workProcessTaskSnapshotList');
  expect(older).not.toContain('Long pending task');
});

it('auto-opens only the latest card and preserves manual choices across remounts', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.createElement('div');
  document.body.append(host);
  const render = (latestId: string) => createElement(ScopedWorkDisclosure, {
    scope: 'task-card-test',
    children: createElement('ol', null,
      createElement(TaskSnapshotCard, { row: snapshot('created', 'created'), isLatest: latestId === 'created' }),
      createElement(TaskSnapshotCard, { row: snapshot('updated', 'updated'), isLatest: latestId === 'updated' })),
  });
  let root = createRoot(host);
  try {
    await act(async () => root.render(render('created')));
    expect([...host.querySelectorAll('.work-card-trigger')].map((button) => button.getAttribute('aria-expanded'))).toEqual(['true', 'false']);
    await act(async () => root.render(render('updated')));
    expect([...host.querySelectorAll('.work-card-trigger')].map((button) => button.getAttribute('aria-expanded'))).toEqual(['false', 'true']);
    await act(async () => (host.querySelectorAll('.work-card-trigger')[0] as HTMLButtonElement).click());
    await act(async () => root.unmount());
    root = createRoot(host);
    await act(async () => root.render(render('updated')));
    expect([...host.querySelectorAll('.work-card-trigger')].map((button) => button.getAttribute('aria-expanded'))).toEqual(['true', 'true']);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});

it('selects the latest historical card even when cards belong to separate turns', () => {
  const section = (id: string, step: Extract<WorkProcessRow, { type: 'taskSnapshot' }>): Extract<WorkProcessRow, { type: 'section' }> => ({
    type: 'section', id, status: 'complete', proseText: '', proseStreaming: false,
    thinkingPreview: '', thinkingLabel: '', thinkingExpandable: false, thinkingOpenByDefault: false,
    stepCount: 1, stepsDisclosure: 'visible', duration: '', defaultOpen: true,
    steps: [step], visibleSteps: [step], loopId: id,
  });
  const html = renderToStaticMarkup(createElement(WorkProcessContent, {
    presentation: { rows: [section('turn-1', snapshot('first', 'created')),
      section('turn-2', snapshot('second', 'updated'))], stepCount: 2, toolCount: 0,
    summary: '', duration: '', actionCount: 2, defaultExpanded: true, important: false },
    disclosureScope: 'nested-task-test',
  }));
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  expect([...parsed.querySelectorAll('.kind-task-snapshot .work-card-trigger')]
    .map((button) => button.getAttribute('aria-expanded'))).toEqual(['false', 'true']);
});

it('locates the latest matching history card after windowing has unmounted it', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const scrollIntoView = vi.fn();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => window.setTimeout(() => callback(0), 0));
  const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
  const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;
  const focus = vi.spyOn(HTMLElement.prototype, 'focus');
  HTMLElement.prototype.scrollIntoView = scrollIntoView;
  const host = document.createElement('div');
  host.className = 'chat-messages';
  Object.defineProperty(host, 'clientHeight', { configurable: true, value: 120 });
  HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect() {
    const rect = originalGetBoundingClientRect.call(this);
    if (this.tagName !== 'OL') return rect;
    return { ...rect, top: -host.scrollTop } as DOMRect;
  };
  document.body.append(host);
  const rows = Array.from({ length: 30 }, (_, index) => snapshot(`history-${index}`, index ? 'updated' : 'created'));
  const root = createRoot(host);
  try {
    await act(async () => root.render(createElement(ScopedWorkDisclosure, { scope: 'task-locator-test',
      children: createElement(MeasuredWorkRows, { rows, className: 'work-process-steps',
        renderRow: createWorkProcessRowRenderer(undefined, undefined, 'normal', 'history-29') }),
    })));
    expect(host.querySelector('[data-work-process-block-id="history-29"]')).toBeNull();
    const candidates: WorkProcessTaskLocationRequest['candidates'] = [];
    await act(async () => {
      document.dispatchEvent(new CustomEvent<WorkProcessTaskLocationRequest>(WORK_PROCESS_LOCATE_TASK_EVENT, {
        detail: { taskId: 'pending', candidates },
      }));
      candidates.at(-1)?.reveal();
    });
    await act(async () => { await new Promise((resolve) => window.setTimeout(resolve, 30)); });
    expect(candidates).toHaveLength(1);
    expect(host.scrollTop).toBeGreaterThan(0);
    expect(host.querySelector('[data-work-process-block-id="history-29"] [data-work-process-task-id="pending"]'))
      .not.toBeNull();
    expect(scrollIntoView).toHaveBeenCalledOnce();
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
    HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
    HTMLElement.prototype.getBoundingClientRect = originalGetBoundingClientRect;
    focus.mockRestore();
  }
});
