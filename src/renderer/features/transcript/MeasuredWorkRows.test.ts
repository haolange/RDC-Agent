// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { MeasuredWorkRows } from './MeasuredWorkRows';
import { ToolRow } from './WorkProcessRowParts';
import { ScopedWorkDisclosure } from './ScopedWorkDisclosure';
import type { WorkProcessRow } from './workProcessTypes';
vi.mock('../../i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
it('crosses the 24/25 row boundary without duplicate events or losing user disclosure', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.createElement('div'); host.className = 'chat-messages'; document.body.append(host);
  const root = createRoot(host);
  const rows: WorkProcessRow[] = Array.from({ length: 25 }, (_, i) => ({ type: 'tool', id: `window-${i}`,
    status: 'complete', verb: 'Read', category: 'task', icon: 'fileRead', groupKind: 'task', family: 'file',
    toolName: 'read_file', target: 'file.txt', duration: '', argsLines: ['file.txt'], previewLines: ['original'], rawLines: ['receipt'] }));
  const render = (count: number) => act(async () => root.render(createElement(ScopedWorkDisclosure, {
    scope: 'window-boundary', children: createElement(MeasuredWorkRows, {
      rows: rows.slice(0, count), className: 'work-process-steps',
      renderRow: row => row.type === 'tool' ? createElement(ToolRow, { key: row.id, row }) : null,
    }),
  })));
  try {
    await render(24); expect(host.querySelectorAll('.work-card-trigger')).toHaveLength(24);
    await act(async () => host.querySelector<HTMLButtonElement>('.work-card-trigger')!.click());
    await render(25); expect(host.querySelector('[data-virtualized="true"]')).not.toBeNull();
    expect(host.querySelector('.work-process-row-spacer')?.getAttribute('aria-hidden')).toBe('true');
    expect(host.querySelector('.work-card-trigger')?.getAttribute('aria-expanded')).toBe('true');
    await render(24); expect(host.querySelectorAll('.work-card-trigger')).toHaveLength(24);
    expect(host.querySelector('.work-process-row-spacer')).toBeNull();
    expect(host.querySelector('.work-card-trigger')?.getAttribute('aria-expanded')).toBe('true');
  } finally { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); }
});
