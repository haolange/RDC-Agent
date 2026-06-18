/**
 * Layout Types - Layout and mode-related type definitions
 */

import type { ExecutableAppMode } from './session';

// UI work modes. Ask is UI/conversation-only and must not be persisted as a run mode.
export type ExecutableAgentMode = ExecutableAppMode;
export type BuiltinAgentMode = 'ask' | 'plan' | 'edit' | ExecutableAgentMode;
export type AgentMode = BuiltinAgentMode | (string & {});

export type ModeIconKey =
  | 'message-orbit'
  | 'route-plan'
  | 'pencil-edit'
  | 'crosshair-bug'
  | 'waveform-gauge'
  | 'spark-tuning'
  | 'compass'
  | 'terminal'
  | 'shield'
  | 'wrench'
  | 'search-lens'
  | 'nodes'
  | 'memory'
  | 'spark';

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
