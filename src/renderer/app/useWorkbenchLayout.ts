import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLayoutStore } from '../stores/layoutStore';
import { usePanelDrawer } from './usePanelDrawer';
import { useNarrowViewport } from './useNarrowViewport';
import { useProjectStore } from '../stores/projectStore';
import {
  getResponsiveMinMainWidth,
  resolveResponsiveSidebarState,
  resolveSidebarWidths,
} from '../shell/layoutGeometry';
import {
  APP_RESIZE_HANDLE_WIDTH,
  LEFT_SIDEBAR_MAX_WIDTH,
  LEFT_SIDEBAR_MIN_WIDTH,
  RIGHT_PANEL_MAX_WIDTH,
  RIGHT_PANEL_MIN_WIDTH,
  RIGHT_RAIL_DRAWER_BREAKPOINT,
  WORKBENCH_CHAT_RAIL_MAX_WIDTH,
} from '@shared/constants/layout';

type DragSide = 'left' | 'right';
type RightRailMode = 'hidden' | 'project' | 'session';

export function useWorkbenchLayout(isReady: boolean) {
  const [appBodyWidth, setAppBodyWidth] = useState(() => (typeof window === 'undefined' ? 0 : Math.max(0, Math.round(window.innerWidth))));
  const [isResizing, setIsResizing] = useState(false);
  const appBodyRef = useRef<HTMLDivElement>(null);
  const dragStateRef = useRef<{ side: DragSide; startX: number; startWidth: number } | null>(null);

  const currentProject = useProjectStore((state) => state.currentProject);
  const currentSession = useProjectStore((state) => state.currentSession);
  const rightRailTarget = useProjectStore((state) => state.rightRailTarget);
  const leftSidebarCollapsed = useLayoutStore((state) => state.leftSidebarCollapsed);
  const rightPanelCollapsed = useLayoutStore((state) => state.rightPanelCollapsed);
  const leftSidebarWidth = useLayoutStore((state) => state.leftSidebarWidth);
  const rightPanelWidth = useLayoutStore((state) => state.rightPanelWidth);
  const setLeftSidebarWidth = useLayoutStore((state) => state.setLeftSidebarWidth);
  const setRightPanelWidth = useLayoutStore((state) => state.setRightPanelWidth);
  const persistLayout = useLayoutStore((state) => state.persistLayout);
  const isRightRailDrawerViewport = useNarrowViewport(RIGHT_RAIL_DRAWER_BREAKPOINT);

  const rightRailMode: RightRailMode = !currentProject
    ? 'hidden'
    : rightRailTarget === 'session' && currentSession
      ? 'session'
      : 'project';
  const isRightRailVisible = rightRailMode !== 'hidden';

  const responsiveSidebarState = useMemo(
    () => resolveResponsiveSidebarState(
      appBodyWidth,
      leftSidebarWidth,
      rightPanelWidth,
      leftSidebarCollapsed,
      rightPanelCollapsed,
      isRightRailVisible,
    ),
    [appBodyWidth, isRightRailVisible, leftSidebarCollapsed, leftSidebarWidth, rightPanelCollapsed, rightPanelWidth],
  );

  const effectiveLeftCollapsed = responsiveSidebarState.leftCollapsed;
  const effectiveRightCollapsed = isRightRailVisible ? responsiveSidebarState.rightCollapsed : true;
  const bothSidebarsCollapsed = effectiveLeftCollapsed && (!isRightRailVisible || effectiveRightCollapsed);
  const leftAutoCollapsed = !leftSidebarCollapsed && effectiveLeftCollapsed;
  const isRightRailAutoCollapsed = isRightRailVisible && !rightPanelCollapsed && effectiveRightCollapsed;
  const isRightRailDrawerMode = isRightRailVisible && (isRightRailDrawerViewport || isRightRailAutoCollapsed);
  const rightRailDrawer = usePanelDrawer(isRightRailDrawerMode);
  const isLeftDrawerMode = appBodyWidth <= 720 || leftAutoCollapsed;
  const leftDrawer = usePanelDrawer(isLeftDrawerMode);
  const closeLeftDrawer = leftDrawer.close;
  useEffect(() => {
    closeLeftDrawer();
  }, [currentProject?.projectId, currentSession?.sessionId, closeLeftDrawer]);

  const resolvedWidths = useMemo(
    () => resolveSidebarWidths(
      appBodyWidth,
      leftSidebarWidth,
      rightPanelWidth,
      effectiveLeftCollapsed,
      effectiveRightCollapsed,
      responsiveSidebarState.minMainWidth,
      isRightRailVisible,
    ),
    [
      appBodyWidth,
      effectiveLeftCollapsed,
      effectiveRightCollapsed,
      isRightRailVisible,
      leftSidebarWidth,
      responsiveSidebarState.minMainWidth,
      rightPanelWidth,
    ],
  );

  useEffect(() => {
    if (!isReady) return;
    const node = appBodyRef.current;
    if (!node) return;

    const syncAppBodyWidth = () => {
      setAppBodyWidth(Math.max(0, Math.round(window.innerWidth)));
    };

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        setAppBodyWidth(Math.max(0, Math.round(entry.contentRect.width)));
      }
    });

    observer.observe(node);
    syncAppBodyWidth();
    window.addEventListener('resize', syncAppBodyWidth);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', syncAppBodyWidth);
    };
  }, [isReady]);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const dragState = dragStateRef.current;
      if (!dragState || !appBodyRef.current) return;

      const containerWidth = appBodyRef.current.getBoundingClientRect().width;
      const { left: resolvedLeft, right: resolvedRight } = resolveSidebarWidths(
        containerWidth,
        leftSidebarWidth,
        rightPanelWidth,
        effectiveLeftCollapsed,
        effectiveRightCollapsed,
        getResponsiveMinMainWidth(containerWidth),
        isRightRailVisible,
      );

      if (dragState.side === 'left' && !effectiveLeftCollapsed) {
        const maxByMain = Math.max(
          LEFT_SIDEBAR_MIN_WIDTH,
          Math.min(
            LEFT_SIDEBAR_MAX_WIDTH,
            containerWidth - getResponsiveMinMainWidth(containerWidth) - APP_RESIZE_HANDLE_WIDTH * 2 - resolvedRight,
          ),
        );
        setLeftSidebarWidth(Math.min(maxByMain, dragState.startWidth + (event.clientX - dragState.startX)));
      }

      if (dragState.side === 'right' && !effectiveRightCollapsed) {
        const maxByMain = Math.max(
          RIGHT_PANEL_MIN_WIDTH,
          Math.min(
            RIGHT_PANEL_MAX_WIDTH,
            containerWidth - getResponsiveMinMainWidth(containerWidth) - APP_RESIZE_HANDLE_WIDTH * 2 - resolvedLeft,
          ),
        );
        setRightPanelWidth(Math.min(maxByMain, dragState.startWidth - (event.clientX - dragState.startX)));
      }
    };

    const handlePointerUp = () => {
      if (!dragStateRef.current) return;
      dragStateRef.current = null;
      setIsResizing(false);
      void persistLayout();
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [
    effectiveLeftCollapsed,
    leftSidebarWidth,
    persistLayout,
    effectiveRightCollapsed,
    isRightRailVisible,
    rightPanelWidth,
    setLeftSidebarWidth,
    setRightPanelWidth,
  ]);

  const startDragging = useCallback((side: DragSide, startWidth: number) => (event: React.PointerEvent<HTMLDivElement>) => {
    dragStateRef.current = { side, startX: event.clientX, startWidth };
    setIsResizing(true);
  }, []);

  return {
    appBodyRef,
    isResizing,
    isRightRailVisible,
    effectiveLeftCollapsed,
    effectiveRightCollapsed,
    bothSidebarsCollapsed,
    leftToggleDisabled: false,
    isLeftDrawerMode,
    isLeftDrawerOpen: leftDrawer.isOpen,
    toggleLeftDrawer: leftDrawer.toggle,
    closeLeftDrawer: leftDrawer.close,
    rightToggleDisabled: !isRightRailVisible,
    isRightRailDrawerMode,
    isRightRailDrawerOpen: rightRailDrawer.isOpen,
    toggleRightRailDrawer: rightRailDrawer.toggle,
    closeRightRailDrawer: rightRailDrawer.close,
    workbenchRailMaxWidth: WORKBENCH_CHAT_RAIL_MAX_WIDTH,
    resolvedWidths,
    startDragging,
  };
}
