/**
 * Layout Types - Layout and mode-related type definitions
 */

// Agent work modes
export type AgentMode = 'debugger' | 'analyzer' | 'optimizer';

export type ModeIconKey = 'crosshair-bug' | 'waveform-gauge' | 'spark-tuning';

// Mode configuration
export interface ModeConfig {
  id: AgentMode;
  label: string;
  icon: ModeIconKey;
  description: string;
  accentColor: string;
  emptyTitle: string;
  emptySubtitle: string;
  helperCopy: string;
  disabled: boolean;
}

// Panel state
export interface PanelState {
  leftSidebarCollapsed: boolean;
  rightPanelCollapsed: boolean;
  rightPanelActiveTab: string;
}
