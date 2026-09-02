import type { AgentRole } from '@shared/types/agent';
import type { AgentManifestDefinition } from '@shared/types/agentManifest';
import type { AppSettings, RuntimeResourceCatalog, LlmAgentRoute, SettingsDiagnostic } from '@shared/types/settings';
import type { EffectiveAgentRuntimeConfig } from '@shared/types/profile';
import { agentRuntimeConfigService } from './AgentRuntimeConfigService';
import { resolveEffectiveModel } from './EffectiveModelResolver';

const profileForAgent = (settings: AppSettings, agentId: AgentRole): AgentManifestDefinition | undefined =>
  settings.agents.definitions.find((definition) => definition.id === agentId && definition.enabled);

export class ExecutionProfileService {
  ensureScaffold(): void {
    agentRuntimeConfigService.ensureScaffold();
  }

  normalizeResourceCatalog(catalog: RuntimeResourceCatalog): RuntimeResourceCatalog {
    this.ensureScaffold();
    return {
      ...catalog,
      availableSkills: agentRuntimeConfigService.listSkills(),
      availableMcpServers: agentRuntimeConfigService.listMcpServers(),
    };
  }

  resolveAgentRuntimeProfile(
    settings: AppSettings,
    agentId: AgentRole,
  ): EffectiveAgentRuntimeConfig {
    const profile = profileForAgent(settings, agentId);
    const route = this.resolveAgentRoute(settings, agentId);
    return {
      agentId,
      systemPrompt: profile?.instructions ?? `You are ${agentId}.`,
      providerId: route?.providerId ?? '',
      modelId: route?.modelId ?? '',
      temperature: 0.3,
      toolAllowlist: profile?.tools ?? [],
      skillIds: profile?.skills ?? [],
      mcpServerIds: profile?.mcpServers ?? [],
      source: { agentProfileId: profile?.id ?? agentId },
    };
  }

  getDiagnostics(settings: AppSettings): SettingsDiagnostic[] {
    return settings.llm.providers.some((provider) => provider.isConfigured)
      ? []
      : [{
          code: 'missing_configured_provider',
          severity: 'warning',
          message: 'No configured provider is available for agent execution.',
        }];
  }

  private resolveAgentRoute(
    settings: AppSettings,
    agentId: AgentRole,
  ): LlmAgentRoute | null {
    const route = settings.agents.definitions.find((entry) => entry.id === agentId)?.compiledRoute
      ?? null;
    if (!route?.providerId || !route.modelId) return null;
    const provider = settings.llm.providers.find((entry) => entry.id === route.providerId);
    if (!provider?.enabled || !provider.isConfigured || provider.status !== 'verified') return null;
    const model = resolveEffectiveModel(route.providerId, route.modelId, settings);
    return model ? { ...route, modelId: model.modelId } : null;
  }
}

export const executionProfileService = new ExecutionProfileService();
