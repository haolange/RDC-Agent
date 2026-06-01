import { useLayoutStore } from '../layoutStore';

type LayoutSidebarSlice = Pick<
  ReturnType<typeof useLayoutStore.getState>,
  'leftSidebarCollapsed' | 'rightPanelCollapsed' | 'leftSidebarWidth' | 'rightPanelWidth'
>;

export interface ResponsiveSidebarState {
  leftSidebarCollapsed: boolean;
  rightPanelCollapsed: boolean;
  leftSidebarWidth: number;
  rightPanelWidth: number;
}

/** Placeholder selector; reads layout slice until workbench wiring migrates off sessionStore. */
export const selectResponsiveSidebarState = (layout: LayoutSidebarSlice): ResponsiveSidebarState => ({
  leftSidebarCollapsed: layout.leftSidebarCollapsed,
  rightPanelCollapsed: layout.rightPanelCollapsed,
  leftSidebarWidth: layout.leftSidebarWidth,
  rightPanelWidth: layout.rightPanelWidth,
});

export const useResponsiveSidebarState = (): ResponsiveSidebarState => (
  useLayoutStore(selectResponsiveSidebarState)
);
