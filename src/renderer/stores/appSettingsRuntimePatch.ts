import type { AgentPermissionMode, AppSettings } from '@shared/types/settings';
import { DEFAULT_AGENT_RUNTIME } from '@shared/constants/appSettingsDefaults';

export function withPermissionMode(settings: AppSettings, mode: AgentPermissionMode): AppSettings {
  const permissions = settings.agentRuntime?.permissions ?? DEFAULT_AGENT_RUNTIME.permissions;
  return {
    ...settings,
    agentRuntime: {
      ...settings.agentRuntime,
      permissions: { ...permissions, mode },
      context: settings.agentRuntime?.context ?? DEFAULT_AGENT_RUNTIME.context,
    },
  };
}

export function withCompactionThresholdPercent(settings: AppSettings, percent: number): AppSettings {
  const context = settings.agentRuntime?.context ?? DEFAULT_AGENT_RUNTIME.context;
  return {
    ...settings,
    agentRuntime: {
      ...settings.agentRuntime,
      permissions: settings.agentRuntime?.permissions ?? DEFAULT_AGENT_RUNTIME.permissions,
      context: { ...context, compactionThresholdPercent: percent },
    },
  };
}
