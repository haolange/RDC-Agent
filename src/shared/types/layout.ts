/**
 * Layout Types - Layout and mode-related type definitions
 */

import type { MissionKind } from './session';

/** Composer / workbench profile-id selector. Not an AppMode. */
export type AgentMode = 'general' | MissionKind | (string & {});

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
