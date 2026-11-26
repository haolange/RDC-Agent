import {
  DEFAULT_AGENT_RUNTIME,
  DEFAULT_APPEARANCE,
  DEFAULT_LAYOUT,
  DEFAULT_PROFILE,
  DEFAULT_TOOLING,
} from '@shared/constants/appSettingsDefaults';
import {
  LEFT_SIDEBAR_COLLAPSED_WIDTH,
  LEFT_SIDEBAR_DEFAULT_WIDTH,
  LEFT_SIDEBAR_MIN_WIDTH,
  RIGHT_PANEL_COLLAPSED_WIDTH,
  RIGHT_PANEL_DEFAULT_WIDTH,
  RIGHT_PANEL_MIN_WIDTH,
  SIDEBAR_MAX_WIDTH,
} from '@shared/constants/layout';
import type { SettingsFile } from './settingsFileSchema';
import type { AgentPermissionMode } from '@shared/types/settings';

export const LEFT_DEFAULTS = {
  width: LEFT_SIDEBAR_DEFAULT_WIDTH,
  min: LEFT_SIDEBAR_MIN_WIDTH,
  max: SIDEBAR_MAX_WIDTH,
  collapsedWidth: LEFT_SIDEBAR_COLLAPSED_WIDTH,
};

export const RIGHT_DEFAULTS = {
  width: RIGHT_PANEL_DEFAULT_WIDTH,
  min: RIGHT_PANEL_MIN_WIDTH,
  max: SIDEBAR_MAX_WIDTH,
  collapsedWidth: RIGHT_PANEL_COLLAPSED_WIDTH,
};

export const VALID_PERMISSION_MODES: AgentPermissionMode[] = ['default', 'auto-review', 'full-access', 'custom'];

/** The settings a missing file stands for; nothing is written until the user changes something. */
export function createDefaultSettingsFile(): SettingsFile {
  return {
    appearance: DEFAULT_APPEARANCE,
    layout: DEFAULT_LAYOUT,
    profile: DEFAULT_PROFILE,
    tooling: DEFAULT_TOOLING,
    agentRuntime: DEFAULT_AGENT_RUNTIME,
    agentModels: { default: {}, byAgent: {} },
    providers: {},
  };
}
