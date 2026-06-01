import type { ReactNode, RefObject } from 'react';
import { ControlPanel } from '../features/debugger/ControlPanel';
import { DeviceSelector } from '../features/captures/DeviceSelector';
import { Sidebar } from '../features/projects/Sidebar';
import { TerminalDrawer } from '../features/terminal/TerminalDrawer';
import { ProfileAvatar } from '../ui/ProfileAvatar';
import { ComposerApprovalOverlay, PlanIntakePanel } from '../features/debugger/PlanIntakePanel';
import { Composer } from '../features/debugger/composer/Composer';
import type { ComposerController } from '../features/debugger/composer/useComposer';
import type { TranslationKey } from '../i18n';
import { APP_RESIZE_HANDLE_WIDTH } from '@shared/constants/layout';

type DragSide = 'left' | 'right';

export interface WorkbenchShellProps {
  appBodyRef: RefObject<HTMLDivElement>;
  isResizing: boolean;
  resolvedWidths: { left: number; right: number };
  effectiveLeftCollapsed: boolean;
  effectiveRightCollapsed: boolean;
  isRightRailVisible: boolean;
  isTerminalOpen: boolean;
  bothSidebarsCollapsed: boolean;
  workbenchRailMaxWidth: string;
  workbenchContentRailWidth: string;
  shellNotice: string | null;
  activityAlertSeverity: 'error' | 'warning' | 'running' | null;
  nickname: string;
  avatarPath: string | undefined;
  composer: ComposerController;
  composerApproval: boolean;
  hasOpenedCaptureForCurrentProject: boolean;
  showMainPromptBar: boolean;
  mainPage: ReactNode;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
  onUserMenuOpen: (event: React.MouseEvent<HTMLButtonElement>) => void;
  onToggleTerminal: () => void;
  onStartDrag: (side: DragSide, startWidth: number) => (event: React.PointerEvent<HTMLDivElement>) => void;
}

export function WorkbenchShell({
  appBodyRef,
  isResizing,
  resolvedWidths,
  effectiveLeftCollapsed,
  effectiveRightCollapsed,
  isRightRailVisible,
  isTerminalOpen,
  bothSidebarsCollapsed,
  workbenchRailMaxWidth,
  workbenchContentRailWidth,
  shellNotice,
  activityAlertSeverity,
  nickname,
  avatarPath,
  composer,
  composerApproval,
  hasOpenedCaptureForCurrentProject,
  showMainPromptBar,
  mainPage,
  t,
  onUserMenuOpen,
  onToggleTerminal,
  onStartDrag,
}: WorkbenchShellProps) {
  return (
    <div
      ref={appBodyRef}
      className={`app-body ${isResizing ? 'is-resizing' : ''}`}
      style={{
        ['--left-sidebar-width' as string]: `${resolvedWidths.left}px`,
        ['--right-panel-width' as string]: `${resolvedWidths.right}px`,
        ['--left-resize-handle-width' as string]: `${effectiveLeftCollapsed ? 0 : APP_RESIZE_HANDLE_WIDTH}px`,
        ['--right-resize-handle-width' as string]: `${!isRightRailVisible || effectiveRightCollapsed ? 0 : APP_RESIZE_HANDLE_WIDTH}px`,
        ['--workbench-rail-max-width' as string]: workbenchRailMaxWidth,
        ['--workbench-content-rail-width' as string]: workbenchContentRailWidth,
        ['--workbench-inline-mode' as string]: bothSidebarsCollapsed ? 'dual-collapsed' : 'sidebar-open',
      }}
    >
      <aside
        className={`app-sidebar-left ${effectiveLeftCollapsed ? 'collapsed' : ''}`}
        data-testid="app-sidebar-left"
      >
        <nav className="sidebar-nav">
          <Sidebar collapsed={effectiveLeftCollapsed} />
        </nav>
        {!effectiveLeftCollapsed && (
          <div className="app-sidebar-footer" data-testid="sidebar-footer">
            <button
              type="button"
              className="footer-entry footer-user-trigger sidebar-user-trigger sidebar-footer-entry"
              data-testid="sidebar-user-settings-trigger"
              onClick={onUserMenuOpen}
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
                  <span className="footer-entry-subtitle">{t('sidebar.userSubtitle')}</span>
                </span>
              </span>
              <span className="footer-entry-trailing">
                <span className="footer-entry-chevron">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </span>
              </span>
            </button>
          </div>
        )}
      </aside>

      <div
        className={`panel-resize-handle panel-resize-handle-left ${effectiveLeftCollapsed ? 'disabled' : ''}`}
        onPointerDown={!effectiveLeftCollapsed ? onStartDrag('left', resolvedWidths.left) : undefined}
        aria-hidden="true"
      />

      <main className={`app-main ${isTerminalOpen ? 'terminal-open' : ''}`}>
        <div className="main-content">
          {shellNotice && (
            <div className="shell-notice" role="status" aria-live="polite">
              {shellNotice}
            </div>
          )}
          <div className="main-floating-utilities">
            <DeviceSelector variant="utility" />
            <button
              type="button"
              className={`main-utility-toggle terminal-pill ${isTerminalOpen ? 'active' : ''} ${activityAlertSeverity ? `terminal-${activityAlertSeverity}` : ''}`}
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
            <PlanIntakePanel />
            {composerApproval ? (
              <ComposerApprovalOverlay />
            ) : (
              <Composer
                composer={composer}
                hasOpenedCaptureForCurrentProject={hasOpenedCaptureForCurrentProject}
              />
            )}
          </div>
        )}
        <TerminalDrawer />
      </main>

      {isRightRailVisible && (
        <>
          <div
            className={`panel-resize-handle panel-resize-handle-right ${effectiveRightCollapsed ? 'disabled' : ''}`}
            onPointerDown={!effectiveRightCollapsed ? onStartDrag('right', resolvedWidths.right) : undefined}
            aria-hidden="true"
          />

          <aside
            className={`app-sidebar-right ${effectiveRightCollapsed ? 'collapsed' : ''}`}
            data-testid="app-sidebar-right"
          >
            <div
              className={`right-panel-body ${effectiveRightCollapsed ? 'collapsed' : ''}`}
              data-testid="control-panel-scroll"
            >
              <ControlPanel />
            </div>
          </aside>
        </>
      )}
    </div>
  );
}
