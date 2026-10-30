// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import type { ElectronAPI } from '@shared/types/electron';
import { useCommandCatalog } from './useCommandCatalog';
import { useAppSettingsStore } from '../stores/appSettingsStore';

it('updates descriptions without fetching again and distinguishes read failures from empty lists', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const list = vi.fn(async () => ({ commands: [{ id: 'help', name: 'help', description: 'Original', aliases: [], category: 'system' }] }));
  const priorApi = window.electronAPI;
  window.electronAPI = { command: { list } } as unknown as ElectronAPI;
  const initial = useAppSettingsStore.getState().settings;
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  let catalog: ReturnType<typeof useCommandCatalog>;
  function Consumer({ enabled }: { enabled: boolean }) {
    catalog = useCommandCatalog(enabled);
    return createElement('div', null, catalog.error ?? catalog.commands[0]?.description);
  }
  try {
    await act(async () => {
      useAppSettingsStore.setState({ settings: { ...initial, appearance: { ...initial.appearance, language: 'zh-CN' } } });
      root.render(createElement(Consumer, { enabled: true }));
    });
    expect(host.textContent).toBe('列出可用命令或查看命令详情');
    await act(async () => useAppSettingsStore.setState({ settings: { ...initial, appearance: { ...initial.appearance, language: 'en' } } }));
    expect(host.textContent).toBe('List all available commands or get details for a specific command');
    expect(list).toHaveBeenCalledOnce();
    await act(async () => root.render(createElement(Consumer, { enabled: false })));
    list.mockRejectedValueOnce(new Error('original read failure'));
    await act(async () => root.render(createElement(Consumer, { enabled: true })));
    expect(catalog!.loading).toBe(false);
    expect(catalog!.error).toBe('original read failure');
    expect(catalog!.commands).toHaveLength(1);
  } finally {
    await act(async () => root.unmount()); host.remove();
    window.electronAPI = priorApi; useAppSettingsStore.setState({ settings: initial }); vi.unstubAllGlobals();
  }
});
