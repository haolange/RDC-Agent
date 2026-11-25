// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { RebuildIndexDialog } from './RebuildIndexDialog';
import type { KnowledgeOperationProgress } from '@shared/types/knowledgeOperation';

vi.mock('../../../../i18n', () => ({
  useI18n: () => ({ language: 'en', t: (key: string, params?: Record<string, unknown>) => (params ? `${key} ${JSON.stringify(params)}` : key) }),
}));

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

type Outcome = 'rebuilt' | 'cancelled';
const index = { revision: 'r', builtAt: '2026-11-25T09:30:00.000Z', cardCount: 3, cardsBySpace: { user: 3 } };
const query = (testId: string) => document.querySelector<HTMLElement>(`[data-testid="${testId}"]`);

function setup() {
  const onClose = vi.fn();
  const onCancel = vi.fn();
  let settle!: { resolve: (outcome: Outcome) => void; reject: (reason: Error) => void };
  const onRebuild = vi.fn(() => new Promise<Outcome>((resolve, reject) => { settle = { resolve, reject }; }));
  const render = (rebuilding: boolean, progress: KnowledgeOperationProgress | null = null, cancelling = false) => act(async () => root.render(
    createElement(RebuildIndexDialog, { open: true, index, rebuilding, progress, cancelling, onRebuild, onCancel, onClose }),
  ));
  return { onClose, onCancel, onRebuild, render, settle: () => settle };
}

it('keeps the dialog open with the reason when the rebuild fails, and closes after a retry succeeds', async () => {
  const { onClose, onRebuild, render, settle } = setup();
  await render(false);
  await act(async () => query('knowledge-center-rebuild-confirm')!.click());
  await render(true);
  expect(query('knowledge-task-progress')?.textContent).toBe('knowledgeCenter.progressRebuilding');
  await act(async () => settle().reject(new Error('KNOWLEDGE_INDEX_LOCKED: index.lock held')));
  await render(false);
  expect(onClose).not.toHaveBeenCalled();
  expect(query('knowledge-center-rebuild-dialog')).not.toBeNull();
  const error = query('knowledge-center-rebuild-error');
  expect(error).not.toBeNull();
  expect(error?.textContent).not.toContain('index.lock');
  await act(async () => error!.querySelector<HTMLButtonElement>('button')!.click());
  await act(async () => settle().resolve('rebuilt'));
  expect(onRebuild).toHaveBeenCalledTimes(2);
  expect(onClose).toHaveBeenCalledTimes(1);
});

it('draws main\'s counts as a determinate bar, offers Cancel while it runs and treats a cancel as a neutral outcome', async () => {
  const { onClose, onCancel, render, settle } = setup();
  await render(false);
  await act(async () => query('knowledge-center-rebuild-confirm')!.click());
  await render(true, { operationId: 'op', phase: 'indexing', done: 4, total: 10 });

  const bar = document.querySelector('[data-testid="knowledge-task-progress"] [role="progressbar"]');
  expect(bar?.getAttribute('aria-valuenow')).toBe('4');
  expect(bar?.getAttribute('aria-valuemax')).toBe('10');
  expect(query('knowledge-task-progress')?.textContent).toContain('knowledgeCenter.progressRebuildIndexing {"done":4,"total":10}');
  const cancel = query('knowledge-center-rebuild-cancel') as HTMLButtonElement;
  expect(cancel.disabled).toBe(false);
  await act(async () => cancel.click());
  expect(onCancel).toHaveBeenCalledTimes(1);
  await render(true, { operationId: 'op', phase: 'indexing', done: 5, total: 10 }, true);
  expect((query('knowledge-center-rebuild-cancel') as HTMLButtonElement).getAttribute('aria-busy')).toBe('true');

  await act(async () => settle().resolve('cancelled'));
  await render(false);
  expect(onClose).not.toHaveBeenCalled();
  expect(query('knowledge-center-rebuild-error')).toBeNull();
  expect(document.querySelector('[role="alert"]')).toBeNull();
  expect(query('knowledge-task-cancelled')?.textContent).toBe('knowledgeCenter.indexRebuildCancelled');
  expect(query('knowledge-center-rebuild-cancel')).toBeNull();
});
