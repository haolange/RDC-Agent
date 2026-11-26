import { act, createElement, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { translate } from '../../../../i18n/messages';
import { TaskDialog } from '../../../../ui/TaskDialog';
import { NewAgentDialog } from './NewAgentDialog';
import { RuntimeScopePanel } from './RuntimeScopePanel';
vi.mock('../../../../i18n', () => ({
  useI18n: () => ({
    t: (key: Parameters<typeof translate>[1], params?: Parameters<typeof translate>[2]) => translate('en', key, params),
  }),
}));

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

async function openFrom(trigger: HTMLButtonElement) {
  await act(async () => {
    trigger.focus();
    trigger.click();
  });
  await act(async () => new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve())));
}

async function escapeDialog() {
  await act(async () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  });
}

it('restores focus to the empty scope create action after cancelling a resource dialog', async () => {
  await act(async () =>
    root.render(
      createElement(RuntimeScopePanel, {
        overview: null,
        scope: 'user',
        kinds: ['mcp'],
        editorPresentation: 'dialog',
        onScopeChange: () => {},
      }),
    ),
  );
  const trigger = host.querySelector<HTMLButtonElement>('.settings-resource-empty button')!;
  await openFrom(trigger);
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  await escapeDialog();
  expect(document.activeElement).toBe(trigger);
});

it('focuses the name in a new Agent dialog and returns to its opener on Escape', async () => {
  function Sample() {
    const [open, setOpen] = useState(false);
    return createElement(
      'div',
      null,
      createElement('button', { onClick: () => setOpen(true) }, 'New Agent'),
      open &&
        createElement(NewAgentDialog, {
          scopeLabel: 'User',
          existingIds: [],
          onCreate: () => {},
          onClose: () => setOpen(false),
        }),
    );
  }
  await act(async () => root.render(createElement(Sample)));
  const trigger = host.querySelector('button')!;
  await openFrom(trigger);
  expect(document.activeElement).toBe(document.querySelector('[role="dialog"] input'));
  await escapeDialog();
  expect(document.activeElement).toBe(trigger);
});

it('returns focus to the next available action when saving removes the original opener', async () => {
  function Sample() {
    const [open, setOpen] = useState(false);
    const [created, setCreated] = useState(false);
    const next = useRef<HTMLButtonElement>(null);
    return createElement(
      'div',
      null,
      created
        ? createElement('button', { key: 'list', ref: next }, 'Add another')
        : createElement('button', { key: 'empty', onClick: () => setOpen(true) }, 'Create'),
      createElement(TaskDialog, {
        open,
        title: 'Create',
        closeLabel: 'Cancel',
        onClose: () => setOpen(false),
        fallbackFocusRef: next,
        children: createElement(
          'button',
          {
            onClick: () => {
              setCreated(true);
              setOpen(false);
            },
          },
          'Save',
        ),
      }),
    );
  }
  await act(async () => root.render(createElement(Sample)));
  await openFrom(host.querySelector('button')!);
  await act(async () => document.querySelector<HTMLButtonElement>('.task-dialog-body button')!.click());
  expect(document.activeElement).toBe(host.querySelector('button'));
});
