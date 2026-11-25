import { useTerminalStore } from '../../stores/terminalStore';
import { resetWorkbenchStores } from '../storesReset';
import { notify } from '../../stores/notificationStore';

import type { ElectronAPI } from '@shared/types/electron';
import type { EventBridgeOptions } from './eventBridgeOptions';

export function subscribeRuntimeLogAppended(electronAPI: ElectronAPI) {
  return electronAPI.events.onRuntimeLogAppended((entry) => {
    useTerminalStore.getState().appendEntry(entry);
  });
}

export function subscribeAppThemeChanged(electronAPI: ElectronAPI, setSystemTheme: (theme: 'light' | 'dark') => void) {
  return electronAPI.events.onAppThemeChanged((theme) => {
    setSystemTheme(theme);
  });
}

export function subscribeShellCommands(electronAPI: ElectronAPI, { t, setSettingsModalOpen, setWindowMaximized }: Pick<EventBridgeOptions, 't' | 'setSettingsModalOpen' | 'setWindowMaximized'>) {
  const handleFileOpen = (paths: unknown) => {
    if (!Array.isArray(paths) || paths.length === 0) return;
    notify.info(t('app.notice.filesReceived', { count: paths.length }));
  };
  const handleCaseNew = () => {
    resetWorkbenchStores();
    notify.info(t('app.notice.newWorkspace'));
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
