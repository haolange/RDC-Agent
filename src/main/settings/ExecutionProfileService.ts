import fs from 'fs';
import path from 'path';
import type { AgentRole } from '@shared/types/agent';
import { DEFAULT_MODEL_ROUTING } from '@shared/types/agent';
import type {
  ConfigurationSettings,
  AppSettings,
  LlmAgentRoute,
  LlmProviderEntry,
  SettingsDiagnostic,
} from '@shared/types/settings';
import type {
  AgentPromptProfile,
  EffectiveAgentRuntimeConfig,
  AgentToolPolicy,
  ModeProfile,
  StagePolicy,
} from '@shared/types/profile';
import type { WorkflowStage } from '@shared/types/workflow';
import { STAGE_PHASES } from '@shared/constants/stages';
import { AGENT_CATEGORIES, AGENT_WRITE_SCOPES } from '@shared/constants/agents';
import { appPathService } from '../runtime/AppPathService';
import { agentRuntimeConfigService } from './AgentRuntimeConfigService';
import { resolveCompatibleAgentRoute } from './LlmRouteCompatibility';

const DEFAULT_MODE_PROFILE_ID = 'debugger.default';

const groupToAllowPattern = (group: string): string => {
  if (group === '*') return '*';
  if (group === 'primitive') return 'primitive.*';
  if (group === 'ui') return 'ui.*';
  if (group.startsWith('rd.')) return group.endsWith('.*') ? group : `${group}.*`;
  return `rd.${group}.*`;
};

const expandToolPolicy = (policy?: AgentToolPolicy): string[] => [
  ...(policy?.allowTools ?? []),
  ...(policy?.allowGroups ?? []).map(groupToAllowPattern),
].filter(Boolean);

const createFallbackModeProfile = (): ModeProfile => ({
  id: DEFAULT_MODE_PROFILE_ID,
  label: 'Debugger Production',
  mode: 'debugger',
  patternId: 'plan-generate-verify',
  skillIds: [],
  mcpServerIds: [],
  stagePolicies: {},
  defaultAgentPrompts: {},
});

const createFallbackAgentProfile = (agentId: AgentRole): AgentPromptProfile => {
  const route = DEFAULT_MODEL_ROUTING[agentId];
  return {
    id: `agent.${agentId}`,
    label: agentId,
    agentId,
    systemPrompt: `You are ${agentId}.`,
    modelProvider: route.provider,
    modelName: route.model,
    temperature: 0.3,
    maxTokens: 4096,
    toolPolicy: { allowTools: [] },
  };
};

const createFallbackStagePolicy = (stage: WorkflowStage): StagePolicy => ({
  id: `stage.${stage}`,
  label: stage,
  stage,
  phase: STAGE_PHASES[stage],
  toolPolicy: { allowTools: [] },
});

export class ExecutionProfileService {
  private getModeProfilesPath(workspaceRoot = appPathService.getWorkspaceRoot()): string {
    return path.join(appPathService.getWorkspacePaths(workspaceRoot).profilesPath, 'modes');
  }

  private getAgentProfilesPath(workspaceRoot = appPathService.getWorkspaceRoot()): string {
    return path.join(appPathService.getWorkspacePaths(workspaceRoot).profilesPath, 'agents');
  }

  private getStagePoliciesPath(workspaceRoot = appPathService.getWorkspaceRoot()): string {
    return path.join(appPathService.getWorkspacePaths(workspaceRoot).policiesPath, 'stages');
  }

  ensureScaffold(workspaceRoot = appPathService.getWorkspaceRoot()): void {
    fs.mkdirSync(this.getModeProfilesPath(workspaceRoot), { recursive: true });
    fs.mkdirSync(this.getAgentProfilesPath(workspaceRoot), { recursive: true });
    fs.mkdirSync(this.getStagePoliciesPath(workspaceRoot), { recursive: true });
    agentRuntimeConfigService.ensureScaffold(workspaceRoot);
  }

  normalizeConfiguration(
    configuration: ConfigurationSettings,
    workspaceRoot = appPathService.getWorkspaceRoot(),
  ): ConfigurationSettings {
    this.ensureScaffold(workspaceRoot);
    const availableModeProfiles = this.listModeProfiles(workspaceRoot);
    const hasActiveProfile = availableModeProfiles.some((profile) => profile.id === configuration.activeModeProfileId);
    const availablePatterns = agentRuntimeConfigService.listPatterns(workspaceRoot);
    const availableSkills = agentRuntimeConfigService.listSkills(workspaceRoot);
    const availableMcpServers = agentRuntimeConfigService.listMcpServers(workspaceRoot);
    const patternIds = new Set(availablePatterns.map((pattern) => pattern.id));
    const modePatternBindings = Object.fromEntries(
      Object.entries(configuration.modePatternBindings ?? {})
        .map(([mode, patternId]) => [mode, patternIds.has(patternId) ? patternId : 'free-agent']),
    );
    return {
      ...configuration,
      activeModeProfileId: hasActiveProfile ? configuration.activeModeProfileId : DEFAULT_MODE_PROFILE_ID,
      availableModeProfiles,
      availablePatterns,
      availableSkills,
      availableMcpServers,
      enabledSkillIds: configuration.enabledSkillIds ?? [],
      enabledMcpServerIds: configuration.enabledMcpServerIds ?? [],
      modePatternBindings: {
        debugger: patternIds.has(modePatternBindings.debugger) ? modePatternBindings.debugger : 'plan-generate-verify',
        analyzer: patternIds.has(modePatternBindings.analyzer) ? modePatternBindings.analyzer : 'free-agent',
        optimizer: patternIds.has(modePatternBindings.optimizer) ? modePatternBindings.optimizer : 'free-agent',
        ...modePatternBindings,
      },
    };
  }

  listModeProfiles(workspaceRoot = appPathService.getWorkspaceRoot()): Array<{ id: string; label: string }> {
    this.ensureScaffold(workspaceRoot);
    return fs.readdirSync(this.getModeProfilesPath(workspaceRoot))
      .filter((entry) => entry.endsWith('.json'))
      .map((entry) => this.readJson<ModeProfile>(path.join(this.getModeProfilesPath(workspaceRoot), entry)))
      .filter((profile): profile is ModeProfile => profile !== null)
      .map((profile) => ({ id: profile.id, label: profile.label }));
  }

  resolveAgentRuntimeProfile(
    settings: AppSettings,
    stage: WorkflowStage,
    agentId: AgentRole,
  ): EffectiveAgentRuntimeConfig {
    const workspaceRoot = settings.workspace.rootPath;
    this.ensureScaffold(workspaceRoot);

    const modeProfile = this.readJson<ModeProfile>(
      path.join(this.getModeProfilesPath(workspaceRoot), `${settings.configuration.activeModeProfileId}.json`),
    ) || createFallbackModeProfile();
    const agentPromptId = modeProfile.defaultAgentPrompts[agentId] || `agent.${agentId}`;
    const agentProfile = this.readJson<AgentPromptProfile>(
      path.join(this.getAgentProfilesPath(workspaceRoot), `${agentId}.json`),
    ) || createFallbackAgentProfile(agentId);
    const stagePolicyId = modeProfile.stagePolicies[stage] || `stage.${stage}`;
    const stagePolicy = this.readJson<StagePolicy>(
      path.join(this.getStagePoliciesPath(workspaceRoot), `${stage}.json`),
    ) || createFallbackStagePolicy(stage);

    const route = this.resolveAgentRoute(settings.llm.agentRoutes, settings.llm.providers, agentId);
    return {
      agentId,
      systemPrompt: [
        agentProfile.systemPrompt,
        stagePolicy.systemPrompt ? `\n\nStage Policy:\n${stagePolicy.systemPrompt}` : '',
      ].join('').trim(),
      providerId: route?.providerId || '',
      modelId: route?.modelId || '',
      temperature: agentProfile.temperature,
      maxTokens: agentProfile.maxTokens,
      category: AGENT_CATEGORIES[agentId],
      writeScope: AGENT_WRITE_SCOPES[agentId],
      stage,
      phase: stagePolicy.phase || STAGE_PHASES[stage],
      toolAllowlist: Array.from(new Set([
        ...expandToolPolicy(stagePolicy.toolPolicy),
        ...expandToolPolicy(agentProfile.toolPolicy),
      ])),
      patternId: modeProfile.patternId ?? settings.configuration.modePatternBindings[modeProfile.mode],
      skillIds: Array.from(new Set([
        ...(modeProfile.skillIds ?? []),
        ...(settings.configuration.enabledSkillIds ?? []),
      ])),
      mcpServerIds: Array.from(new Set([
        ...(modeProfile.mcpServerIds ?? []),
        ...(settings.configuration.enabledMcpServerIds ?? []),
      ])),
      source: {
        modeProfileId: modeProfile.id,
        stagePolicyId,
        agentProfileId: agentPromptId,
      },
    };
  }

  getDiagnostics(settings: AppSettings): SettingsDiagnostic[] {
    const diagnostics: SettingsDiagnostic[] = [];
    if (!settings.configuration.availableModeProfiles.length) {
      diagnostics.push({
        code: 'missing_mode_profile',
        severity: 'warning',
        message: 'No execution mode profile found. Falling back to debugger.default.',
      });
    }
    if (!settings.llm.providers.some((provider) => provider.isConfigured)) {
      diagnostics.push({
        code: 'missing_configured_provider',
        severity: 'warning',
        message: 'No configured provider available for Debugger mode.',
      });
    }
    return diagnostics;
  }

  private resolveAgentRoute(
    routes: LlmAgentRoute[],
    providers: LlmProviderEntry[],
    agentId: AgentRole,
  ): LlmAgentRoute | null {
    const resolution = resolveCompatibleAgentRoute(routes, providers, agentId);
    if (!resolution.route || !resolution.provider) {
      return null;
    }

    const modelExists = resolution.provider.models.some((model) => model.enabled && model.id === resolution.route?.modelId);
    return modelExists ? resolution.route : null;
  }

  private readJson<T>(filePath: string): T | null {
    try {
      if (!fs.existsSync(filePath)) {
        return null;
      }
      return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
    } catch (error) {
      console.warn('[ExecutionProfileService] Failed to read JSON:', filePath, error);
      return null;
    }
  }
}

export const executionProfileService = new ExecutionProfileService();
