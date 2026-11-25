// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { RebuildIndexDialog } from './RebuildIndexDialog';

vi.mock('../../../../i18n', () => ({ useI18n: () => ({ language: 'en', t: (key: string) => key }) }));

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

it('shows the rebuild running, keeps the dialog open with the reason when it fails, and closes after a retry succeeds', async () => {
  const onClose = vi.fn();
  let settle!: { resolve: () => void; reject: (reason: Error) => void };
  const onRebuild = vi.fn(() => new Promise<void>((resolve, reject) => { settle = { resolve, reject }; }));
  const render = (rebuilding: boolean) => act(async () => root.render(createElement(RebuildIndexDialog, {
    open: true, index: { revision: 'r', builtAt: '2026-11-25T09:30:00.000Z', cardCount: 3, cardsBySpace: { user: 3 } }, rebuilding, onRebuild, onClose })));
  await render(false);
  await act(async () => document.querySelector<HTMLButtonElement>('[data-testid="knowledge-center-rebuild-confirm"]')!.click());
  await render(true);
  expect(document.querySelector('[data-testid="knowledge-task-progress"]')?.textContent).toBe('knowledgeCenter.progressRebuilding');
  await act(async () => settle.reject(new Error('KNOWLEDGE_INDEX_LOCKED: index.lock held')));
  await render(false);
  expect(onClose).not.toHaveBeenCalled();
  expect(document.querySelector('[data-testid="knowledge-center-rebuild-dialog"]')).not.toBeNull();
  const error = document.querySelector('[data-testid="knowledge-center-rebuild-error"]');
  expect(error).not.toBeNull();
  expect(error?.textContent).not.toContain('index.lock');
  await act(async () => error!.querySelector<HTMLButtonElement>('button')!.click());
  await act(async () => settle.resolve());
  expect(onRebuild).toHaveBeenCalledTimes(2);
  expect(onClose).toHaveBeenCalledTimes(1);
});
