import { create } from 'zustand';

type AgentMode = 'debugger' | 'analyzer' | 'optimizer';

interface LayoutState {
  // 当前模式
  currentMode: AgentMode;
  setCurrentMode: (mode: AgentMode) => void;
  
  // 面板状态
  leftSidebarCollapsed: boolean;
  rightPanelCollapsed: boolean;
  toggleLeftSidebar: () => void;
  toggleRightPanel: () => void;
  
  // 右侧面板活跃 Tab
  rightPanelActiveTab: string;
  setRightPanelActiveTab: (tab: string) => void;
}

export const useLayoutStore = create<LayoutState>((set) => ({
  currentMode: 'debugger',
  setCurrentMode: (mode) => set({ currentMode: mode }),
  
  leftSidebarCollapsed: false,
  rightPanelCollapsed: false,
  toggleLeftSidebar: () => set((state) => ({ leftSidebarCollapsed: !state.leftSidebarCollapsed })),
  toggleRightPanel: () => set((state) => ({ rightPanelCollapsed: !state.rightPanelCollapsed })),
  
  rightPanelActiveTab: 'monitor',
  setRightPanelActiveTab: (tab) => set({ rightPanelActiveTab: tab }),
}));
