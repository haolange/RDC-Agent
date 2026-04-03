import { create } from 'zustand';
import type { AppSettings } from '@shared/types/settings';
import type { AgentMode } from '@shared/types/layout';
import {
  LEFT_SIDEBAR_COLLAPSED_WIDTH,
  LEFT_SIDEBAR_DEFAULT_WIDTH,
  LEFT_SIDEBAR_MAX_WIDTH,
  LEFT_SIDEBAR_MIN_WIDTH,
  RIGHT_PANEL_COLLAPSED_WIDTH,
  RIGHT_PANEL_DEFAULT_WIDTH,
  RIGHT_PANEL_MAX_WIDTH,
  RIGHT_PANEL_MIN_WIDTH,
} from '@shared/constants/layout';

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

interface LayoutState {
  currentMode: AgentMode;
  leftSidebarCollapsed: boolean;
  rightPanelCollapsed: boolean;
  leftSidebarWidth: number;
  rightPanelWidth: number;
  leftSidebarExpandedWidth: number;
  rightPanelExpandedWidth: number;
  hydrateFromSettings: (settings: AppSettings) => void;
  setCurrentMode: (mode: AgentMode) => void;
  toggleLeftSidebar: () => Promise<void>;
  toggleRightPanel: () => Promise<void>;
  setLeftSidebarWidth: (width: number) => void;
  setRightPanelWidth: (width: number) => void;
  persistLayout: () => Promise<void>;
}

const persistLayout = async (state: Pick<
  LayoutState,
  'leftSidebarCollapsed'
  | 'rightPanelCollapsed'
  | 'leftSidebarWidth'
  | 'rightPanelWidth'
  | 'leftSidebarExpandedWidth'
  | 'rightPanelExpandedWidth'
>): Promise<void> => {
  await window.electronAPI.settings.set({
    layout: {
      leftSidebar: {
        collapsed: state.leftSidebarCollapsed,
        width: state.leftSidebarWidth,
        expandedWidth: state.leftSidebarExpandedWidth,
      },
      rightPanel: {
        collapsed: state.rightPanelCollapsed,
        width: state.rightPanelWidth,
        expandedWidth: state.rightPanelExpandedWidth,
      },
    },
  });
};

export const useLayoutStore = create<LayoutState>((set, get) => ({
  currentMode: 'debugger',
  leftSidebarCollapsed: false,
  rightPanelCollapsed: false,
  leftSidebarWidth: LEFT_SIDEBAR_DEFAULT_WIDTH,
  rightPanelWidth: RIGHT_PANEL_DEFAULT_WIDTH,
  leftSidebarExpandedWidth: LEFT_SIDEBAR_DEFAULT_WIDTH,
  rightPanelExpandedWidth: RIGHT_PANEL_DEFAULT_WIDTH,
  hydrateFromSettings: (settings) => set({
    leftSidebarCollapsed: settings.layout.leftSidebar.collapsed,
    rightPanelCollapsed: settings.layout.rightPanel.collapsed,
    leftSidebarWidth: settings.layout.leftSidebar.collapsed
      ? LEFT_SIDEBAR_COLLAPSED_WIDTH
      : clamp(settings.layout.leftSidebar.width, LEFT_SIDEBAR_MIN_WIDTH, LEFT_SIDEBAR_MAX_WIDTH),
    rightPanelWidth: settings.layout.rightPanel.collapsed
      ? RIGHT_PANEL_COLLAPSED_WIDTH
      : clamp(settings.layout.rightPanel.width, RIGHT_PANEL_MIN_WIDTH, RIGHT_PANEL_MAX_WIDTH),
    leftSidebarExpandedWidth: clamp(
      settings.layout.leftSidebar.expandedWidth,
      LEFT_SIDEBAR_MIN_WIDTH,
      LEFT_SIDEBAR_MAX_WIDTH,
    ),
    rightPanelExpandedWidth: clamp(
      settings.layout.rightPanel.expandedWidth,
      RIGHT_PANEL_MIN_WIDTH,
      RIGHT_PANEL_MAX_WIDTH,
    ),
  }),
  setCurrentMode: (mode) => set({ currentMode: mode }),
  toggleLeftSidebar: async () => {
    const state = get();
    const nextCollapsed = !state.leftSidebarCollapsed;
    const nextState = {
      leftSidebarCollapsed: nextCollapsed,
      leftSidebarWidth: nextCollapsed
        ? LEFT_SIDEBAR_COLLAPSED_WIDTH
        : clamp(state.leftSidebarExpandedWidth, LEFT_SIDEBAR_MIN_WIDTH, LEFT_SIDEBAR_MAX_WIDTH),
    };
    set(nextState);
    await get().persistLayout();
  },
  toggleRightPanel: async () => {
    const state = get();
    const nextCollapsed = !state.rightPanelCollapsed;
    const nextState = {
      rightPanelCollapsed: nextCollapsed,
      rightPanelWidth: nextCollapsed
        ? RIGHT_PANEL_COLLAPSED_WIDTH
        : clamp(state.rightPanelExpandedWidth, RIGHT_PANEL_MIN_WIDTH, RIGHT_PANEL_MAX_WIDTH),
    };
    set(nextState);
    await get().persistLayout();
  },
  setLeftSidebarWidth: (width) => set({
    leftSidebarCollapsed: false,
    leftSidebarWidth: clamp(width, LEFT_SIDEBAR_MIN_WIDTH, LEFT_SIDEBAR_MAX_WIDTH),
    leftSidebarExpandedWidth: clamp(width, LEFT_SIDEBAR_MIN_WIDTH, LEFT_SIDEBAR_MAX_WIDTH),
  }),
  setRightPanelWidth: (width) => set({
    rightPanelCollapsed: false,
    rightPanelWidth: clamp(width, RIGHT_PANEL_MIN_WIDTH, RIGHT_PANEL_MAX_WIDTH),
    rightPanelExpandedWidth: clamp(width, RIGHT_PANEL_MIN_WIDTH, RIGHT_PANEL_MAX_WIDTH),
  }),
  persistLayout: async () => {
    const state = get();
    await persistLayout(state);
  },
}));
