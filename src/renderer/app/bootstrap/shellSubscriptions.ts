import type { RuntimeLogEntry } from '@shared/types/runtimeLog';
import { useTerminalStore } from '../../stores/terminalStore';
import { resetWorkbenchStores } from '../storesReset';

import type { ElectronAPI } from '@shared/types/electron';
import type { EventBridgeOptions } from './eventBridgeOptions';

export function subscribeRuntimeLogAppended(electronAPI: ElectronAPI) {
  return electronAPI.events.onRuntimeLogAppended((entry) => {
    useTerminalStore.getState().appendEntry(entry as RuntimeLogEntry);
  });
}

export function subscribeAppThemeChanged(electronAPI: ElectronAPI, setSystemTheme: (theme: 'light' | 'dark') => void) {
  return electronAPI.events.onAppThemeChanged((theme) => {
    setSystemTheme(theme);
  });
}

export function subscribeShellCommands(electronAPI: ElectronAPI, { showNotice, t, setSettingsModalOpen, setWindowMaximized }: Pick<EventBridgeOptions, 'showNotice' | 't' | 'setSettingsModalOpen' | 'setWindowMaximized'>) {
  const handleFileOpen = (paths: unknown) => {
    if (!Array.isArray(paths) || paths.length === 0) return;
    showNotice(t('app.notice.filesReceived', { count: paths.length }));
  };
  const handleCaseNew = () => {
    resetWorkbenchStores();
    showNotice(t('app.notice.newWorkspace'));
  };
  const handleSettingsOpen = () => {
    setSettingsModalOpen(true);
  };
  const handleWindowStateChange = (isMaximized: unknown) => {
    setWindowMaximized(Boolean(isMaximized));
  };

  electronAPI.on('file:open', handleFileOpen);
  electronAPI.on('case:new', handleCaseNew);
  electronAPI.on('settings:open', handleSettingsOpen);
  electronAPI.on('window:maximized-changed', handleWindowStateChange);

  return () => {
    electronAPI.off('file:open', handleFileOpen);
    electronAPI.off('case:new', handleCaseNew);
    electronAPI.off('settings:open', handleSettingsOpen);
    electronAPI.off('window:maximized-changed', handleWindowStateChange);
  };
}
