import type { ReactNode, RefObject } from 'react';
import { ControlPanel } from '../features/right-rail';
import { DeviceSelector } from '../features/captures/DeviceSelector';
import { Sidebar } from '../features/sidebar/Sidebar';
import { TerminalDrawer } from '../features/terminal/TerminalDrawer';
import { Button } from '../ui/Button';
import { ProfileAvatar } from '../patterns/ProfileAvatar';
import { Composer } from '../features/composer/Composer';
import type { ComposerController } from '../features/composer/useComposer';
import type { TranslationKey } from '../i18n';
import { APP_RESIZE_HANDLE_WIDTH } from '@shared/constants/layout';
import { useDynStyle } from '../lib/useDynStyle';
import { isDockedResizeHandleVisible, ResizeHandle } from '../shell/ResizeHandle';
import { WorkbenchPanelDrawer } from './WorkbenchPanelDrawer';

type DragSide = 'left' | 'right';

export interface WorkbenchShellProps {
  appBodyRef: RefObject<HTMLDivElement>;
  isResizing: boolean;
  resolvedWidths: { left: number; right: number };
  effectiveLeftCollapsed: boolean;
  effectiveRightCollapsed: boolean;
  isLeftDrawerMode: boolean;
  isLeftDrawerOpen: boolean;
  onCloseLeftDrawer: () => void;
  isRightRailVisible: boolean;
  isRightRailDrawerMode: boolean;
  isRightRailDrawerOpen: boolean;
  onCloseRightRailDrawer: () => void;
  isTerminalOpen: boolean;
  bothSidebarsCollapsed: boolean;
  workbenchRailMaxWidth: string;
  shellNotice: string | null;
  activityAlertSeverity: 'error' | 'warning' | 'running' | null;
  nickname: string;
  avatarPath: string | undefined;
  composer: ComposerController;
  showMainPromptBar: boolean;
  mainPage: ReactNode;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
  onOpenKnowledgeCenter: () => void;
  isUserMenuOpen: boolean;
  onUserMenuToggle: (event: React.MouseEvent<HTMLButtonElement>) => void;
  onToggleTerminal: () => void;
  onStartDrag: (side: DragSide, startWidth: number) => (event: React.PointerEvent<HTMLDivElement>) => void;
}

export function WorkbenchShell({
  appBodyRef,
  isResizing,
  resolvedWidths,
  effectiveLeftCollapsed,
  effectiveRightCollapsed,
  isLeftDrawerMode,
  isLeftDrawerOpen,
  onCloseLeftDrawer,
  isRightRailVisible,
  isRightRailDrawerMode,
  isRightRailDrawerOpen,
  onCloseRightRailDrawer,
  isTerminalOpen,
  bothSidebarsCollapsed,
  workbenchRailMaxWidth,
  shellNotice,
  activityAlertSeverity,
  nickname,
  avatarPath,
  composer,
  showMainPromptBar,
  mainPage,
  t,
  onOpenKnowledgeCenter,
  isUserMenuOpen,
  onUserMenuToggle,
  onToggleTerminal,
  onStartDrag,
}: WorkbenchShellProps) {
  const showDockedRightRail = isRightRailVisible && !isRightRailDrawerMode;
  const showLeftResizeHandle = isDockedResizeHandleVisible(!isLeftDrawerMode, effectiveLeftCollapsed);
  const showRightResizeHandle = isDockedResizeHandleVisible(showDockedRightRail, effectiveRightCollapsed);
  const shellDynStyle = useDynStyle({
    '--left-sidebar-width': `${resolvedWidths.left}px`,
    '--right-panel-width': `${resolvedWidths.right}px`,
    '--left-resize-handle-width': `${showLeftResizeHandle ? APP_RESIZE_HANDLE_WIDTH : 0}px`,
    '--right-resize-handle-width': `${showRightResizeHandle ? APP_RESIZE_HANDLE_WIDTH : 0}px`,
    '--workbench-rail-max-width': workbenchRailMaxWidth,
    '--workbench-inline-mode': bothSidebarsCollapsed ? 'dual-collapsed' : 'sidebar-open',
  });

  const sidebarContent = <>
    <nav className="sidebar-nav">
      <Sidebar collapsed={isLeftDrawerMode ? false : effectiveLeftCollapsed} />
    </nav>
    {(isLeftDrawerMode || !effectiveLeftCollapsed) && (
      <div className="app-sidebar-footer" data-testid="sidebar-footer">
        <Button
          variant="ghost"
          className="footer-entry sidebar-footer-entry"
          data-testid="sidebar-knowledge-center-trigger"
          onClick={() => { onCloseLeftDrawer(); onOpenKnowledgeCenter(); }}
          title={t('knowledgeCenter.title')}
          aria-label={t('knowledgeCenter.title')}
        >
          <span className="footer-entry-main">
            <span className="sidebar-knowledge-icon" aria-hidden="true">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                <path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15z" />
              </svg>
            </span>
            <span className="footer-entry-copy">
              <span className="footer-entry-title">{t('knowledgeCenter.sidebarLabel')}</span>
            </span>
          </span>
        </Button>
        <Button
          variant="ghost"
          className="footer-entry sidebar-footer-entry"
          data-testid="sidebar-user-settings-trigger"
          aria-haspopup="dialog"
          aria-expanded={isUserMenuOpen}
          aria-controls={isUserMenuOpen ? 'sidebar-user-menu' : undefined}
          onClick={(event) => { onCloseLeftDrawer(); onUserMenuToggle(event); }}
          title={t('sidebar.userSettings')}
          aria-label={t('sidebar.userSettings')}
        >
          <span className="footer-entry-main">
            <ProfileAvatar
              className="footer-entry-avatar"
              avatarPath={avatarPath}
              nickname={nickname}
            />
            <span className="footer-entry-copy">
              <span className="footer-entry-title">{nickname}</span>
            </span>
          </span>
          <span className="footer-entry-trailing">
            <span className="footer-entry-chevron">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </span>
          </span>
        </Button>
      </div>
    )}
  </>;

  return (
    <div
      ref={appBodyRef}
      className={`app-body ${isResizing ? 'is-resizing' : ''} ${isLeftDrawerMode ? 'has-left-drawer' : ''}`}
      {...shellDynStyle}
    >
      <aside
        className={`app-sidebar-left ${effectiveLeftCollapsed ? 'collapsed' : ''}`}
        data-testid="app-sidebar-left"
      >
        {!isLeftDrawerMode ? sidebarContent : null}
      </aside>

      {showLeftResizeHandle ? (
        <ResizeHandle side="left" onDragStart={onStartDrag('left', resolvedWidths.left)} />
      ) : (
        <div aria-hidden="true" />
      )}

      <main className={`app-main ${isTerminalOpen ? 'terminal-open' : ''}`}>
        <div className="main-content">
          {shellNotice && (
            <div className="shell-notice" role="status" aria-live="polite">
              {shellNotice}
            </div>
          )}
          <div className="main-floating-utilities">
            <DeviceSelector />
            <button
              type="button"
              className={`main-utility-toggle terminal-pill ${isTerminalOpen ? 'is-active' : ''} ${activityAlertSeverity ? `terminal-${activityAlertSeverity}` : ''}`}
              onClick={onToggleTerminal}
              data-testid="terminal-toggle"
              aria-label={isTerminalOpen ? t('terminal.close') : t('terminal.open')}
              title={isTerminalOpen ? t('terminal.close') : t('terminal.open')}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M4 17l6-6-6-6" />
                <path d="M12 19h8" />
              </svg>
              {activityAlertSeverity && (
                <span className={`terminal-status-badge ${activityAlertSeverity}`} aria-hidden="true" />
              )}
            </button>
          </div>
          <div className="main-page-shell">{mainPage}</div>
        </div>
        {showMainPromptBar && (
          <div className="main-input-bar">
            <Composer
              composer={composer}
            />
          </div>
        )}
        <TerminalDrawer />
      </main>

      {showDockedRightRail && (
        <>
          {showRightResizeHandle ? (
            <ResizeHandle side="right" onDragStart={onStartDrag('right', resolvedWidths.right)} />
          ) : (
            <div aria-hidden="true" />
          )}

          <aside
            className={`app-sidebar-right ${effectiveRightCollapsed ? 'collapsed' : ''}`}
            data-testid="app-sidebar-right"
          >
            <div
              className={`right-panel-body ${effectiveRightCollapsed ? 'collapsed' : ''}`}
              data-testid="right-rail-scroll"
            >
              <ControlPanel />
            </div>
          </aside>
        </>
      )}
      {isLeftDrawerMode ? (
        <WorkbenchPanelDrawer data-testid="left-navigation-drawer" keepMounted side="left" title={t('sidebar.projects')} closeLabel={t('app.closePanel')} open={isLeftDrawerOpen} onClose={onCloseLeftDrawer}>
          {sidebarContent}
        </WorkbenchPanelDrawer>
      ) : null}
      {isRightRailVisible && isRightRailDrawerMode ? (
        <WorkbenchPanelDrawer data-testid="right-rail-drawer" title={t('app.inspector')} closeLabel={t('app.closePanel')} open={isRightRailDrawerOpen} onClose={onCloseRightRailDrawer}>
          <ControlPanel />
        </WorkbenchPanelDrawer>
      ) : null}

    </div>
  );
}
