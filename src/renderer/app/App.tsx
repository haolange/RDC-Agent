import React, { useCallback, useEffect, useState } from 'react';
import { DebuggerPage } from '../features/transcript/DebuggerPage';
import { UserMenu } from '../shell/UserMenu';
import { TitleBar } from '../shell/TitleBar';
import { SettingsModal } from '../features/settings/SettingsModal';
import { KnowledgeCenterModal } from '../features/knowledge/KnowledgeCenterModal';
import { useComposer } from '../features/composer/useComposer';
import { CommandPalette } from '../patterns/CommandPalette';
import { NotificationToast } from './NotificationToast';
import { AppProviders } from './AppProviders';
import { AppShell } from '../shell/AppShell';
import { WorkbenchShell } from './WorkbenchShell';
import { useWorkbenchLayout } from './useWorkbenchLayout';
import { useAppBootstrap } from './bootstrap/useAppBootstrap';
import { useIpcEventBridge, useSyncCapturesFromSnapshot } from './bootstrap/useIpcEventBridge';
import { useLayoutStore } from '../stores/layoutStore';
import { useProjectStore } from '../stores/projectStore';
import { useSessionStore } from '../stores/sessionStore';
import { useAppSettingsStore } from '../stores/appSettingsStore';
import { useTerminalStore } from '../stores/terminalStore';
import { useI18n } from '../i18n';
import { useWindowControls } from '../hooks/useWindowControls';
import type { ResolvedTheme } from '@shared/types/settings';

const App: React.FC = () => {
  const { t } = useI18n();
  const [isLoading, setIsLoading] = useState(true);
  const [, setConnectionStatus] = useState<'connected' | 'degraded' | 'offline'>('offline');
  const [windowMaximized, setWindowMaximized] = useState(false);
  const [shellNotice, setShellNotice] = useState<string | null>(null);
  const [userMenuAnchor, setUserMenuAnchor] = useState<{ element: HTMLButtonElement; rect: DOMRect } | null>(null);
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const [knowledgeCenterOpen, setKnowledgeCenterOpen] = useState(false);
  const [runtimeTestMode, setRuntimeTestMode] = useState<boolean | null>(null);

  const currentProject = useProjectStore((state) => state.currentProject);
  const currentRun = useSessionStore((state) => state.currentRun);
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

  const layout = useWorkbenchLayout(!isLoading);
  const isTerminalOpen = useTerminalStore((state) => state.isOpen);
  const toggleTerminalOpen = useTerminalStore((state) => state.toggleOpen);
  const activityEntries = useTerminalStore((state) => state.entries);

  const hasActiveDebugRun = Boolean(
    currentRun
    && ['planning', 'awaiting_input', 'awaiting_approval', 'queued', 'running', 'stopping'].includes(currentRun.status),
  );

  const showNotice = useCallback((message: string) => {
    setShellNotice(message);
  }, []);

  const applyAppearancePreference = useCallback((mutation: () => Promise<void>) => {
    void mutation().catch((error: unknown) => {
      showNotice(error instanceof Error ? error.message : 'Unable to update appearance preferences.');
    });
  }, [showNotice]);

  const syncCapturesFromSnapshot = useSyncCapturesFromSnapshot();
  const handleToggleLeftSidebar = useCallback(() => {
    if (layout.isLeftDrawerMode) {
      layout.closeRightRailDrawer();
      layout.toggleLeftDrawer();
      return;
    }
    void toggleLeftSidebar();
  }, [layout, toggleLeftSidebar]);

  const composer = useComposer({
    showNotice,
    effectiveLeftCollapsed: layout.effectiveLeftCollapsed,
    leftToggleDisabled: layout.leftToggleDisabled,
    toggleLeftSidebar: handleToggleLeftSidebar,
    openSettings: () => setSettingsModalOpen(true),
  });

  useAppBootstrap({
    setIsLoading,
    setConnectionStatus,
    runtimeTestMode,
    setRuntimeTestMode,
    setWindowMaximized,
    resolvedTheme,
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

  const leftPanelToggleLabel = (layout.isLeftDrawerMode ? !layout.isLeftDrawerOpen : layout.effectiveLeftCollapsed)
    ? t('app.leftSidebarExpand') : t('app.leftSidebarCollapse');
  const rightPanelToggleLabel = layout.isRightRailDrawerMode
    ? (layout.isRightRailDrawerOpen ? t('app.rightPanelCollapse') : t('app.rightPanelExpand'))
    : (layout.effectiveRightCollapsed ? t('app.rightPanelExpand') : t('app.rightPanelCollapse'));
  const handleToggleRightRail = useCallback(() => {
    if (layout.isRightRailDrawerMode) {
      layout.closeLeftDrawer();
      layout.toggleRightRailDrawer();
      return;
    }
    void toggleRightPanel();
  }, [layout, toggleRightPanel]);

  const { handleWindowMinimize, handleWindowToggleMaximize, handleWindowClose } = useWindowControls(setWindowMaximized);

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
      <AppShell
        titleBar={<TitleBar
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
          onToggleLeft={handleToggleLeftSidebar}
          onToggleRight={handleToggleRightRail}
          onMinimize={handleWindowMinimize}
          onToggleMaximize={handleWindowToggleMaximize}
          onClose={handleWindowClose}
        />}

        body={<WorkbenchShell
          appBodyRef={layout.appBodyRef}
          isResizing={layout.isResizing}
          resolvedWidths={layout.resolvedWidths}
          effectiveLeftCollapsed={layout.effectiveLeftCollapsed}
          effectiveRightCollapsed={layout.effectiveRightCollapsed}
          isRightRailVisible={layout.isRightRailVisible}
          isLeftDrawerMode={layout.isLeftDrawerMode}
          isLeftDrawerOpen={layout.isLeftDrawerOpen}
          onCloseLeftDrawer={layout.closeLeftDrawer}
          isRightRailDrawerMode={layout.isRightRailDrawerMode}
          isRightRailDrawerOpen={layout.isRightRailDrawerOpen}
          onCloseRightRailDrawer={layout.closeRightRailDrawer}
          isTerminalOpen={isTerminalOpen}
          bothSidebarsCollapsed={layout.bothSidebarsCollapsed}
          workbenchRailMaxWidth={layout.workbenchRailMaxWidth}
          shellNotice={shellNotice}
          activityAlertSeverity={activityAlertSeverity}
          nickname={nickname}
          avatarPath={avatarPath}
          composer={composer}
          showMainPromptBar={Boolean(currentProject)}
          mainPage={<DebuggerPage mode={currentMode} />}
          t={t}
          onOpenKnowledgeCenter={() => setKnowledgeCenterOpen(true)}
          isUserMenuOpen={Boolean(userMenuAnchor)}
          onUserMenuToggle={(event) => {
            const element = event.currentTarget;
            const rect = element.getBoundingClientRect();
            setUserMenuAnchor((current) => current ? null : { element, rect });
          }}
          onToggleTerminal={() => toggleTerminalOpen()}
          onStartDrag={layout.startDragging}
        />}
        overlays={<>

        <UserMenu
          anchorRect={userMenuAnchor?.rect ?? null}
          anchorElement={userMenuAnchor?.element ?? null}
          open={Boolean(userMenuAnchor)}
          settings={settings}
          onClose={() => setUserMenuAnchor(null)}
          onOpenSettings={() => {
            setUserMenuAnchor(null);
            setSettingsModalOpen(true);
          }}
          onThemeChange={(theme) => applyAppearancePreference(() => setTheme(theme))}
          onLanguageChange={(language) => applyAppearancePreference(() => setLanguage(language))}
          onFontScaleChange={(fontScale) => applyAppearancePreference(() => setFontScale(fontScale))}
        />

        <SettingsModal
          open={settingsModalOpen}
          settings={settings}
          onClose={() => setSettingsModalOpen(false)}
        />

        <KnowledgeCenterModal
          open={knowledgeCenterOpen}
          onClose={() => setKnowledgeCenterOpen(false)}
        />

        <CommandPalette
          onExecute={(cmd) => {
            if (cmd === '/config') {
              setSettingsModalOpen(true);
            }
          }}
        />

        <NotificationToast />
        </>}
      />
    </AppProviders>
  );
};

export default App;
