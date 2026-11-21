import { useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { APP_RESIZE_HANDLE_WIDTH } from '@shared/constants/layout';
import { PlanReaderHost } from '../features/transcript/PlanReaderHost';
import { WorkbenchReadingLayoutContext } from '../lib/WorkbenchReadingLayout';
import { RightRail } from '../features/right-rail/RightRail';
import { Sidebar } from '../features/sidebar/Sidebar';
import { TerminalDrawer } from '../features/terminal/TerminalDrawer';
import { Composer } from '../features/composer/Composer';
import { useDynStyle } from '../lib/useDynStyle';
import { isDockedResizeHandleVisible, ResizeHandle } from '../shell/ResizeHandle';
import { WorkbenchPanelDrawer } from './WorkbenchPanelDrawer';
import { SidebarFooter } from './SidebarFooter';
import type { TranslationKey } from '../i18n';
import type { ComposerController } from '../features/composer/useComposer';

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
  nickname: string;
  avatarPath: string | undefined;
  composer: ComposerController;
  showMainPromptBar: boolean;
  mainPage: ReactNode;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
  onOpenKnowledgeCenter: () => void;
  isUserMenuOpen: boolean;
  onUserMenuToggle: (event: React.MouseEvent<HTMLButtonElement>) => void;
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
  nickname,
  avatarPath,
  composer,
  showMainPromptBar,
  mainPage,
  t,
  onOpenKnowledgeCenter,
  isUserMenuOpen,
  onUserMenuToggle,
  onStartDrag,
}: WorkbenchShellProps) {
  const workArea = useRef<HTMLElement>(null);
  const [composerShell, setComposerShell] = useState<HTMLDivElement | null>(null);
  const readingLayout = useMemo(() => ({ workArea, composerShell,
    layoutRevision: [resolvedWidths.left, resolvedWidths.right, effectiveLeftCollapsed, effectiveRightCollapsed,
      isLeftDrawerMode, isRightRailDrawerMode, isRightRailVisible, isTerminalOpen, workbenchRailMaxWidth].join(':'),
  }), [composerShell, resolvedWidths.left, resolvedWidths.right, effectiveLeftCollapsed, effectiveRightCollapsed,
    isLeftDrawerMode, isRightRailDrawerMode, isRightRailVisible, isTerminalOpen, workbenchRailMaxWidth]);
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
      <SidebarFooter
        t={t}
        nickname={nickname}
        avatarPath={avatarPath}
        isUserMenuOpen={isUserMenuOpen}
        onCloseLeftDrawer={onCloseLeftDrawer}
        onOpenKnowledgeCenter={onOpenKnowledgeCenter}
        onUserMenuToggle={onUserMenuToggle}
      />
    )}
  </>;

  return (
    <WorkbenchReadingLayoutContext.Provider value={readingLayout}>
    <PlanReaderHost>
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

      <main ref={workArea} className={`app-main ${isTerminalOpen ? 'terminal-open' : ''}`}>
        <div className="main-content">
          <div className="main-page-shell">{mainPage}</div>
        </div>
        {showMainPromptBar && (
          <div className="main-input-bar">
            <Composer
              composer={composer}
              shellRef={setComposerShell}
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
              <RightRail />
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
          <RightRail />
        </WorkbenchPanelDrawer>
      ) : null}

    </div>
    </PlanReaderHost>
    </WorkbenchReadingLayoutContext.Provider>
  );
}
