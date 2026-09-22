// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TerminalDrawer } from './index';
import { useTerminalStore } from '../../../stores/terminalStore';
import type { RuntimeLogEntry } from '@shared/types/runtimeLog';

vi.mock('../../../i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
let host: HTMLDivElement;
let root: Root;
const initial = useTerminalStore.getState();
const entry: RuntimeLogEntry = { id: 'error', timestamp: 1, scope: 'app', namespace: 'tool', severity: 'error', title: 'Failed command', summary: 'Failure', detail: 'Exact failure detail', raw: { exitCode: 1 } };
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  useTerminalStore.setState({ ...initial, isOpen: true, entries: [entry], refreshEntries: vi.fn(async () => {}) });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); useTerminalStore.setState(initial, true); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('renders error details, filters, follows new output only when enabled and closes', () => {
  act(() => root.render(createElement(TerminalDrawer)));
  const body = host.querySelector<HTMLDivElement>('.runtime-terminal-activity-body')!;
  Object.defineProperty(body, 'scrollHeight', { configurable: true, value: 900 });
  const row = host.querySelector<HTMLButtonElement>('.runtime-terminal-entry-main')!;
  row.focus(); act(() => row.click());
  expect(document.activeElement).toBe(row);
  expect(row.getAttribute('aria-expanded')).toBe('true');
  expect(host.textContent).toContain('Exact failure detail');
  expect(host.textContent).toContain('"exitCode": 1');
  const filter = host.querySelector<HTMLButtonElement>('[data-testid="runtime-terminal-filter-toggle"]')!;
  act(() => filter.click()); expect(filter.getAttribute('aria-expanded')).toBe('true');
  act(() => document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
  expect(filter.getAttribute('aria-expanded')).toBe('false');
  act(() => useTerminalStore.setState({ entries: [entry, { ...entry, id: 'second' }] }));
  expect(body.scrollTop).toBe(900);
  const follow = host.querySelector<HTMLButtonElement>('[data-testid="runtime-terminal-follow"]')!;
  act(() => follow.click()); body.scrollTop = 50;
  act(() => useTerminalStore.setState({ entries: [entry, { ...entry, id: 'second' }, { ...entry, id: 'third' }] }));
  expect(body.scrollTop).toBe(50); expect(follow.getAttribute('aria-pressed')).toBe('false');
  act(() => host.querySelector<HTMLButtonElement>('.runtime-terminal-close-workspace')!.click());
  expect(useTerminalStore.getState().isOpen).toBe(false);
  expect(host.querySelector('[data-testid="runtime-terminal"]')?.getAttribute('aria-hidden')).toBe('true');
});
