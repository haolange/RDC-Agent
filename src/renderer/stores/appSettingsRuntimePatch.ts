import type { AgentPermissionMode, AppSettings } from '@shared/types/settings';
import { DEFAULT_SETTINGS } from './defaultAppSettings';

export function withPermissionMode(settings: AppSettings, mode: AgentPermissionMode): AppSettings {
  const permissions = settings.agentRuntime?.permissions ?? DEFAULT_SETTINGS.agentRuntime.permissions;
  return {
    ...settings,
    agentRuntime: {
      ...settings.agentRuntime,
      permissions: { ...permissions, mode },
      context: settings.agentRuntime?.context ?? DEFAULT_SETTINGS.agentRuntime.context,
    },
  };
}

export function withCompactionThresholdPercent(settings: AppSettings, percent: number): AppSettings {
  const context = settings.agentRuntime?.context ?? DEFAULT_SETTINGS.agentRuntime.context;
  return {
    ...settings,
    agentRuntime: {
      ...settings.agentRuntime,
      permissions: settings.agentRuntime?.permissions ?? DEFAULT_SETTINGS.agentRuntime.permissions,
      context: { ...context, compactionThresholdPercent: percent },
    },
  };
}
