// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ExportKnowledgeDialog } from './ExportKnowledgeDialog';

vi.mock('../../../../i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));

type Props = Parameters<typeof ExportKnowledgeDialog>[0];

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

const exporter = (overrides: Partial<Props['exporter']>): Props['exporter'] => ({
  open: true, openPanel: vi.fn(), close: vi.fn(), scope: 'space', setScope: vi.fn(), format: 'package', setFormat: vi.fn(),
  spaceId: 'user', setSpaceId: vi.fn(), counts: { selected: 0, filtered: 0, space: 3 }, pendingCount: 3, picked: new Set(),
  pickable: [], pickerQuery: '', setPickerQuery: vi.fn(), togglePicked: vi.fn(), pickAll: vi.fn(), clearPicked: vi.fn(),
  canExport: true, busy: false, error: null, cancelled: false, result: null, run: vi.fn(), cancelExport: vi.fn(),
  operation: { running: false, progress: null, cancelling: false },
  ...overrides,
} as Props['exporter']);

const render = (props: Props) => act(async () => root.render(createElement(ExportKnowledgeDialog, props)));
const query = <T extends Element = HTMLElement>(testId: string) => document.querySelector<T>(`[data-testid="${testId}"]`);

it('shows the running export\'s counts, wires Cancel, and states a cancelled export without an error', async () => {
  const cancelExport = vi.fn();
  await render({
    exporter: exporter({
      busy: true, cancelExport,
      operation: { running: true, progress: { operationId: 'op', phase: 'reading', done: 2, total: 3 }, cancelling: false },
    }),
    spaces: [],
  });
  expect(query('knowledge-task-progress')?.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('2');
  await act(async () => query<HTMLButtonElement>('knowledge-center-export-cancel')!.click());
  expect(cancelExport).toHaveBeenCalledTimes(1);

  await render({ exporter: exporter({ cancelled: true }), spaces: [] });
  expect(query('knowledge-center-export-cancel')).toBeNull();
  expect(query('knowledge-task-cancelled')?.textContent).toBe('knowledgeCenter.exportCancelled');
  expect(document.querySelector('[role="alert"]')).toBeNull();
  expect(query<HTMLButtonElement>('knowledge-center-export-run')?.disabled).toBe(false);
});
