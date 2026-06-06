import React, { useCallback, useEffect, useState } from 'react';
import { DebuggerPage } from '../pages/Debugger';
import { UserMenu } from '../shell/UserMenu';
import { TitleBar } from '../shell/TitleBar';
import { SettingsModal } from '../features/settings/SettingsModal';
import { useComposer } from '../features/debugger/composer/useComposer';
import { AppProviders } from './AppProviders';
import { WorkbenchShell } from './WorkbenchShell';
import { useWorkbenchLayout } from './useWorkbenchLayout';
import { useAppBootstrap } from './bootstrap/useAppBootstrap';
import { useIpcEventBridge, useSyncCapturesFromSnapshot } from './bootstrap/useIpcEventBridge';
import { useLayoutStore } from '../stores/layoutStore';
import { useCaptureStore } from '../stores/captureStore';
import { useProjectStore } from '../stores/projectStore';
import { useSessionStore } from '../stores/sessionStore';
import { useWorkflowStore } from '../stores/workflowStore';
import { useAppSettingsStore } from '../stores/appSettingsStore';
import { useTerminalStore } from '../stores/terminalStore';
import { useI18n } from '../i18n';
import type { ResolvedTheme } from '@shared/types/settings';

const App: React.FC = () => {
  const { t } = useI18n();
  const [isLoading, setIsLoading] = useState(true);
  const [, setConnectionStatus] = useState<'connected' | 'degraded' | 'offline'>('offline');
  const [windowMaximized, setWindowMaximized] = useState(false);
  const [shellNotice, setShellNotice] = useState<string | null>(null);
  const [userMenuAnchor, setUserMenuAnchor] = useState<DOMRect | null>(null);
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const [runtimeTestMode, setRuntimeTestMode] = useState<boolean | null>(null);

  const currentProject = useProjectStore((state) => state.currentProject);
  const currentRun = useSessionStore((state) => state.currentRun);
  const openedCapture = useCaptureStore((state) => state.openedCapture);
  const composerApproval = useWorkflowStore((state) => state.tracePresentation?.approval ?? null);
  const currentMode = useLayoutStore((state) => state.currentMode);
  const toggleLeftSidebar = useLayoutStore((state) => state.toggleLeftSidebar);
  const toggleRightPanel = useLayoutStore((state) => state.toggleRightPanel);

  const settings = useAppSettingsStore((state) => state.settings);
  const systemTheme = useAppSettingsStore((state) => state.systemTheme);
  const setTheme = useAppSettingsStore((state) => state.setTheme);
  const setLanguage = useAppSettingsStore((state) => state.setLanguage);
  const setFontScale = useAppSettingsStore((state) => state.setFontScale);

  const resolvedTheme: ResolvedTheme = settings.appearance.theme === 'system'
    ? systemTheme
    : settings.appearance.theme;
  const nickname = settings.profile.nickname || t('sidebar.userName');
  const avatarPath = settings.profile.avatarPath;

  const layout = useWorkbenchLayout();
  const isTerminalOpen = useTerminalStore((state) => state.isOpen);
  const toggleTerminalOpen = useTerminalStore((state) => state.toggleOpen);
  const activityEntries = useTerminalStore((state) => state.entries);

  const hasOpenedCaptureForCurrentProject = Boolean(
    currentProject
    && openedCapture?.projectId === currentProject.projectId
    && openedCapture.status === 'open',
  );
  const hasActiveDebugRun = Boolean(
    currentRun
    && ['planning', 'awaiting_input', 'awaiting_approval', 'queued', 'running', 'stopping'].includes(currentRun.status),
  );

  const showNotice = useCallback((message: string) => {
    setShellNotice(message);
  }, []);

  const syncCapturesFromSnapshot = useSyncCapturesFromSnapshot();

  const composer = useComposer({
    showNotice,
    hasOpenedCaptureForCurrentProject,
    effectiveLeftCollapsed: layout.effectiveLeftCollapsed,
    leftToggleDisabled: layout.leftToggleDisabled,
    toggleLeftSidebar,
  });

  useAppBootstrap({
    setIsLoading,
    setConnectionStatus,
    runtimeTestMode,
    setRuntimeTestMode,
    setWindowMaximized,
    resolvedTheme,
    hasActiveDebugRun,
  });

  useIpcEventBridge({
    syncCapturesFromSnapshot,
    showNotice,
    setSettingsModalOpen,
    setWindowMaximized,
    t,
  });

  useEffect(() => {
    if (!shellNotice) return;
    const timeoutId = window.setTimeout(() => setShellNotice(null), 3200);
    return () => window.clearTimeout(timeoutId);
  }, [shellNotice]);

  const activityAlertSeverity = activityEntries.some((entry) => entry.severity === 'error')
    ? 'error'
    : activityEntries.some((entry) => entry.severity === 'warning')
      ? 'warning'
      : hasActiveDebugRun
        ? 'running'
        : null;

  const leftPanelToggleLabel = layout.effectiveLeftCollapsed ? t('app.leftSidebarExpand') : t('app.leftSidebarCollapse');
  const rightPanelToggleLabel = layout.effectiveRightCollapsed ? t('app.rightPanelExpand') : t('app.rightPanelCollapse');

  const handleWindowMinimize = useCallback(async () => {
    await window.electronAPI?.windowControls.minimize();
  }, []);

  const handleWindowToggleMaximize = useCallback(async () => {
    const electronAPI = window.electronAPI;
    if (!electronAPI) return;
    setWindowMaximized(await electronAPI.windowControls.toggleMaximize());
  }, []);

  const handleWindowClose = useCallback(async () => {
    await window.electronAPI?.windowControls.close();
  }, []);

  if (isLoading) {
    return (
      <div className="loading-screen">
        <div className="loading-logo">RD</div>
        <div className="loading-text">{t('app.loadingShell')}</div>
        <div className="loading-bar" />
      </div>
    );
  }

  return (
    <AppProviders>
      <div className="app-container">
        <TitleBar
          effectiveLeftCollapsed={layout.effectiveLeftCollapsed}
          effectiveRightCollapsed={layout.effectiveRightCollapsed}
          isRightRailVisible={layout.isRightRailVisible}
          leftToggleDisabled={layout.leftToggleDisabled}
          rightToggleDisabled={layout.rightToggleDisabled}
          leftPanelToggleLabel={leftPanelToggleLabel}
          rightPanelToggleLabel={rightPanelToggleLabel}
          autoCollapsedTitle={t('app.panelAutoCollapsed')}
          windowMaximized={windowMaximized}
          windowControlsLabel={t('app.windowControls')}
          windowMinimizeLabel={t('app.windowMinimize')}
          windowMaximizeLabel={t('app.windowMaximize')}
          windowRestoreLabel={t('app.windowRestore')}
          windowCloseLabel={t('app.windowClose')}
          onToggleLeft={() => void toggleLeftSidebar()}
          onToggleRight={() => void toggleRightPanel()}
          onMinimize={handleWindowMinimize}
          onToggleMaximize={handleWindowToggleMaximize}
          onClose={handleWindowClose}
        />

        <WorkbenchShell
          appBodyRef={layout.appBodyRef}
          isResizing={layout.isResizing}
          resolvedWidths={layout.resolvedWidths}
          effectiveLeftCollapsed={layout.effectiveLeftCollapsed}
          effectiveRightCollapsed={layout.effectiveRightCollapsed}
          isRightRailVisible={layout.isRightRailVisible}
          isTerminalOpen={isTerminalOpen}
          bothSidebarsCollapsed={layout.bothSidebarsCollapsed}
          workbenchRailMaxWidth={layout.workbenchRailMaxWidth}
          workbenchContentRailWidth={layout.workbenchContentRailWidth}
          shellNotice={shellNotice}
          activityAlertSeverity={activityAlertSeverity}
          nickname={nickname}
          avatarPath={avatarPath}
          composer={composer}
          composerApproval={Boolean(composerApproval)}
          hasOpenedCaptureForCurrentProject={hasOpenedCaptureForCurrentProject}
          showMainPromptBar
          mainPage={<DebuggerPage mode={currentMode} />}
          t={t}
          onUserMenuOpen={(event) => setUserMenuAnchor(event.currentTarget.getBoundingClientRect())}
          onToggleTerminal={() => toggleTerminalOpen()}
          onStartDrag={layout.startDragging}
        />

        <UserMenu
          anchorRect={userMenuAnchor}
          open={Boolean(userMenuAnchor)}
          settings={settings}
          onClose={() => setUserMenuAnchor(null)}
          onOpenSettings={() => {
            setUserMenuAnchor(null);
            setSettingsModalOpen(true);
          }}
          onThemeChange={(theme) => void setTheme(theme)}
          onLanguageChange={(language) => void setLanguage(language)}
          onFontScaleChange={(fontScale) => void setFontScale(fontScale)}
        />

        <SettingsModal
          open={settingsModalOpen}
          settings={settings}
          onClose={() => setSettingsModalOpen(false)}
        />
      </div>
    </AppProviders>
  );
};

export default App;
