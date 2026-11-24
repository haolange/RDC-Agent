import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ClipboardContext } from '../../../../lib/clipboard';
import { useAppSettingsStore } from '../../../../stores/appSettingsStore';
import { HooksSettings } from './HooksSettings';
import { McpServicesPanel } from './McpServicesPanel';
import type { RdcRuntimeOverview } from '@shared/types/rdcRuntime';

const source = { id: 'review', scope: 'project', sourceHash: 'revision', sourcePath: '/project/review' } as const;
const overview: RdcRuntimeOverview = {
  resources: [
    { ...source, kind: 'mcp', content: '{"name":"Review service"}', effectiveStatus: 'effective', diagnostics: [] },
    { ...source, kind: 'hook', content: 'id: review\ncommand: verify', effectiveStatus: 'effective', diagnostics: [] },
  ],
  hooks: [{ ...source, event: 'tool.before-call', failurePolicy: 'warn', enabled: true, trusted: true,
    needsRetrust: false, trustFingerprint: 'trusted revision' }],
  mcpServers: [{ ...source, name: 'Review service', trusted: true, needsRetrust: false, transport: 'stdio' }],
  projectRoot: '/project', userRoot: '/user', userPaths: {}, diagnostics: [], skillSelection: { status: 'ready', options: [] },
  knowledge: { userPath: '/user' }, memory: { userPath: '/user' },
};
const props = { overview, scope: 'project', onScopeChange: vi.fn(), onChanged: vi.fn() } as const;
const initialSettings = useAppSettingsStore.getState().settings;
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const testId = (id: string) => host.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const click = async (element: HTMLElement) => act(async () => element.click());

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  useAppSettingsStore.setState({ settings: { ...initialSettings, appearance: { ...initialSettings.appearance, language: 'en' } } });
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  useAppSettingsStore.setState({ settings: initialSettings });
  vi.unstubAllGlobals();
});

it('shows a live MCP state only when received and places trust once beside its actions', async () => {
  const getStatusSummary = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([
    { id: source.id, name: 'Review service', connectionStatus: 'unknown', toolCount: 0 },
  ]);
  vi.stubGlobal('electronAPI', { mcp: { getStatusSummary } });
  await act(async () => root.render(createElement(McpServicesPanel, props)));
  expect(testId('settings-mcp-connection-badge')).toBeNull();
  await click(testId('settings-mcp-status-refresh')!);
  expect(testId('settings-mcp-connection-badge')?.textContent).toBe('Unknown');
  await click(host.querySelector<HTMLButtonElement>('button[aria-pressed]')!);
  const detail = testId('settings-mcp-detail')!;
  expect(detail.querySelectorAll('[data-testid="settings-mcp-trust-badge"]')).toHaveLength(1);
  expect(detail.querySelector('header [data-testid="settings-mcp-diagnostics-menu"]')).not.toBeNull();
  expect(detail.textContent).not.toContain(source.sourcePath);
});

it('keeps Hook receipts copyable while the result shows the actual outcome', async () => {
  const receipt = { hookId: source.id, status: 'completed', allowed: true, stdout: 'internal output', stderr: '' };
  const failed = { ...receipt, status: 'failed', allowed: true, stderr: 'diagnostic detail' };
  const testHook = vi.fn().mockResolvedValueOnce(receipt).mockResolvedValueOnce(failed);
  vi.stubGlobal('electronAPI', { rdcRuntime: { testHook } });
  const copy = vi.fn(async () => true);
  await act(async () => root.render(createElement(ClipboardContext.Provider, { value: copy }, createElement(HooksSettings, props))));
  await click(host.querySelector<HTMLButtonElement>('button.ui-list-row')!);
  const run = testId('settings-hook-detail-test')!;
  await click(run);
  expect(testId('settings-hook-test-result')?.textContent).toBe('Hook test passed.');
  expect(host.textContent).not.toContain(receipt.stdout);
  await click(testId('settings-hook-detail')!.querySelector<HTMLElement>('header [data-testid="settings-hook-diagnostics-menu"]')!);
  await click(document.querySelector<HTMLElement>('[data-testid="settings-hook-diagnostics"]')!);
  expect(copy).toHaveBeenLastCalledWith(expect.stringContaining(JSON.stringify(receipt, null, 2)));
  await click(run);
  const error = testId('settings-hook-test-result')!;
  expect(error.getAttribute('role')).toBe('alert');
  expect(error.textContent).toContain('Hook test failed.');
  expect(error.textContent).not.toContain(failed.stderr);
  await click(error.querySelector('button')!);
  expect(copy).toHaveBeenLastCalledWith(JSON.stringify(failed, null, 2));
});
