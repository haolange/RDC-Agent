// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { RightRailTaskList } from './RightRailTaskList';
import type { TaskRailItem } from '@shared/types/trace';

vi.mock('../../i18n', () => ({
  useI18n: () => ({
    t: (key: string, values?: Record<string, number>) => (values ? `${key}:${JSON.stringify(values)}` : key),
  }),
}));
vi.mock('../../stores/appSettingsStore', () => ({
  useAppSettingsStore: (select: (state: unknown) => unknown) =>
    select({ settings: { agents: { definitions: [{ id: 'debugger', name: 'Debugger' }] } } }),
}));

const task = (index: number, status: TaskRailItem['status'], extra: Partial<TaskRailItem> = {}): TaskRailItem => ({
  id: `task-${index}`,
  sessionId: 's',
  traceLaneId: 'lane',
  branchId: 'main',
  title: `Task ${index}`,
  status,
  displayState: status,
  order: index,
  createdAt: '2026-11-20T00:00:00Z',
  updatedAt: '2026-11-20T00:00:00Z',
  ...extra,
});

it('names delegated and background executions on hover and folds finished work in long lists', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const tasks = [
    task(0, 'completed'),
    task(1, 'completed'),
    task(2, 'completed'),
    task(3, 'in_progress', {
      execution: {
        mode: 'subagent',
        status: 'running',
        dispatch: 'background',
        agentId: 'debugger',
        model: { providerId: 'p', modelId: 'qa-stub:4b' },
      },
    }),
    task(4, 'in_progress', {
      execution: { mode: 'direct', status: 'running', agentId: 'general', model: { providerId: 'p', modelId: 'm' } },
    }),
    task(5, 'pending'),
    task(6, 'blocked', { displayState: 'failed' }),
  ];
  try {
    await act(async () => root.render(createElement(RightRailTaskList, { tasks, locateLabel: 'locate' })));
    const titles = () => [...host.querySelectorAll('.right-rail-task-title')].map((node) => node.textContent);
    expect(titles()).toEqual(['Task 3', 'Task 4', 'Task 5', 'Task 6']);
    const hover = (index: number) =>
      [...host.querySelectorAll('.right-rail-task-row > button')][index].getAttribute('data-tooltip');
    expect(hover(0)).toBe(
      'Task 3 · chat.workProcessTaskStatus.in_progress · control.rightRail.tasks.background · Debugger · qa-stub:4b',
    );
    expect(hover(1)).toBe('Task 4 · chat.workProcessTaskStatus.in_progress');
    expect(host.querySelector('.right-rail-task-row')?.textContent).toBe('Task 3');
    expect(host.querySelector('.status-failed .task-status-marker')?.getAttribute('aria-label')).toBe(
      'chat.workProcessTaskStatus.failed',
    );
    await act(async () => host.querySelector<HTMLButtonElement>('.right-rail-task-fold')!.click());
    expect(titles()).toHaveLength(7);
    expect(host.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('3');
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
