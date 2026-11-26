// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { MeasuredWorkRows } from './MeasuredWorkRows';
import { ToolRow } from './WorkProcessRowParts';
import { ScopedWorkDisclosure } from './ScopedWorkDisclosure';
import { WorkProcessFoldProvider } from './workProcessFold';
import type { WorkProcessRow } from './workProcessTypes';
vi.mock('../../i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
it('crosses the 24/25 row boundary without duplicate events or losing user disclosure', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.createElement('div');
  host.className = 'chat-messages';
  document.body.append(host);
  const root = createRoot(host);
  const rows: WorkProcessRow[] = Array.from({ length: 25 }, (_, i) => ({
    type: 'tool',
    id: `window-${i}`,
    status: 'complete',
    verb: 'Read',
    category: 'task',
    icon: 'file-read',
    groupKind: 'task',
    family: 'file',
    toolName: 'read_file',
    target: 'file.txt',
    duration: '',
    argsLines: ['file.txt'],
    previewLines: ['original'],
    rawLines: ['receipt'],
  }));
  const render = (count: number) =>
    act(async () =>
      root.render(
        createElement(ScopedWorkDisclosure, {
          scope: 'window-boundary',
          children: createElement(MeasuredWorkRows, {
            rows: rows.slice(0, count),
            className: 'work-process-steps',
            renderRow: (row) => (row.type === 'tool' ? createElement(ToolRow, { key: row.id, row }) : null),
          }),
        }),
      ),
    );
  try {
    await render(24);
    expect(host.querySelectorAll('.work-card-trigger')).toHaveLength(24);
    await act(async () => host.querySelector<HTMLButtonElement>('.work-card-trigger')!.click());
    await render(25);
    expect(host.querySelector('[data-virtualized="true"]')).not.toBeNull();
    expect(host.querySelector('.work-process-row-spacer')?.getAttribute('aria-hidden')).toBe('true');
    expect(host.querySelector('.work-card-trigger')?.getAttribute('aria-expanded')).toBe('true');
    await render(24);
    expect(host.querySelectorAll('.work-card-trigger')).toHaveLength(24);
    expect(host.querySelector('.work-process-row-spacer')).toBeNull();
    expect(host.querySelector('.work-card-trigger')?.getAttribute('aria-expanded')).toBe('true');
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});

it('follows the scroller when the Working window switches between following and showing everything', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const transcript = document.createElement('div');
  transcript.className = 'chat-messages';
  document.body.append(transcript);
  const root = createRoot(transcript);
  const rows: WorkProcessRow[] = Array.from({ length: 30 }, (_, i) => ({
    type: 'tool',
    id: `scroller-${i}`,
    status: 'complete',
    verb: 'Read',
    category: 'task',
    icon: 'file-read',
    groupKind: 'task',
    family: 'file',
    toolName: 'read_file',
    target: 'file.txt',
    duration: '',
    argsLines: ['file.txt'],
    previewLines: [],
    rawLines: [],
  }));
  const listening = new Set<EventTarget>();
  // The DOM's own EventTarget (the test realm's global may be Node's).
  let target: EventTarget = transcript;
  while (!Object.prototype.hasOwnProperty.call(target, 'addEventListener')) target = Object.getPrototypeOf(target);
  const domEventTarget = target as typeof EventTarget.prototype;
  const addListener = domEventTarget.addEventListener;
  const removeListener = domEventTarget.removeEventListener;
  vi.spyOn(domEventTarget, 'addEventListener').mockImplementation(function (
    this: EventTarget,
    type,
    listener,
    options,
  ) {
    if (type === 'scroll') listening.add(this);
    return addListener.call(this, type, listener, options);
  });
  vi.spyOn(domEventTarget, 'removeEventListener').mockImplementation(function (
    this: EventTarget,
    type,
    listener,
    options,
  ) {
    if (type === 'scroll') listening.delete(this);
    return removeListener.call(this, type, listener, options);
  });
  const render = (following: boolean) =>
    act(async () =>
      root.render(
        createElement(
          'div',
          { className: `work-process-viewport${following ? ' is-following' : ''}` },
          createElement(
            'div',
            { className: 'work-process-viewport-scroller' },
            createElement(ScopedWorkDisclosure, {
              scope: 'scroller-switch',
              children: createElement(MeasuredWorkRows, {
                rows,
                className: 'work-process-steps',
                renderRow: (row) => (row.type === 'tool' ? createElement(ToolRow, { key: row.id, row }) : null),
              }),
            }),
          ),
        ),
      ),
    );
  try {
    await render(true);
    const inner = transcript.querySelector('.work-process-viewport-scroller')!;
    expect([...listening]).toEqual([inner]);
    await render(false);
    expect([...listening]).toEqual([transcript]);
    await render(true);
    expect([...listening]).toEqual([inner]);
  } finally {
    await act(async () => root.unmount());
    transcript.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});

it('mounts no rows while Working is folded and the window again when it opens', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.createElement('div');
  host.className = 'chat-messages';
  document.body.append(host);
  const root = createRoot(host);
  const rows: WorkProcessRow[] = Array.from({ length: 60 }, (_, i) => ({
    type: 'tool',
    id: `folded-${i}`,
    status: 'complete',
    verb: 'Read',
    category: 'task',
    icon: 'file-read',
    groupKind: 'task',
    family: 'file',
    toolName: 'read_file',
    target: 'file.txt',
    duration: '',
    argsLines: ['file.txt'],
    previewLines: ['original'],
    rawLines: ['receipt'],
  }));
  const render = (folded: boolean) =>
    act(async () =>
      root.render(
        createElement(ScopedWorkDisclosure, {
          scope: 'folded-window',
          children: createElement(WorkProcessFoldProvider, {
            value: folded,
            children: createElement(MeasuredWorkRows, {
              rows,
              className: 'work-process-steps',
              renderRow: (row) => (row.type === 'tool' ? createElement(ToolRow, { key: row.id, row }) : null),
            }),
          }),
        }),
      ),
    );
  try {
    await render(false);
    expect(host.querySelector('[data-virtualized="true"]')).not.toBeNull();
    await render(true);
    expect(host.querySelectorAll('.work-card-trigger')).toHaveLength(0);
    expect(host.querySelector('.work-process-row-spacer')).toBeNull();
    await render(false);
    expect(host.querySelector('[data-virtualized="true"]')).not.toBeNull();
    expect(host.querySelectorAll('.work-card-trigger').length).toBeGreaterThan(0);
    expect(host.querySelectorAll('.work-card-trigger').length).toBeLessThan(60);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
