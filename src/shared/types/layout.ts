/**
 * Layout Types - Layout and mode-related type definitions
 */

import type { ExecutableAppMode } from './session';

// UI work modes. Ask is UI/conversation-only and must not be persisted as a run mode.
export type ExecutableAgentMode = ExecutableAppMode;
export type AgentMode = 'ask' | ExecutableAgentMode;

export type ModeIconKey = 'message-orbit' | 'crosshair-bug' | 'waveform-gauge' | 'spark-tuning';

// Mode configuration
export interface ModeConfig {
  id: AgentMode;
  label: string;
  icon: ModeIconKey;
  description: string;
  accentColor: string;
  disabled: boolean;
}

// Panel state
export interface PanelState {
  leftSidebarCollapsed: boolean;
  rightPanelCollapsed: boolean;
  rightPanelActiveTab: string;
}
