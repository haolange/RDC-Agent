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
  ModeProfile,
  StagePolicy,
} from '@shared/types/profile';
import type { WorkflowStage } from '@shared/types/workflow';
import { STAGE_PHASES } from '@shared/constants/stages';
import { AGENT_CATEGORIES, AGENT_WRITE_SCOPES } from '@shared/constants/agents';
import { appPathService } from '../runtime/AppPathService';
import { resolveCompatibleAgentRoute } from './LlmRouteCompatibility';

const DEFAULT_MODE_PROFILE_ID = 'debugger.default';

const DEFAULT_AGENT_PROMPTS: Record<AgentRole, string> = {
  'ask_agent': [
    'You are the RDC-Agent Ask assistant.',
    'Stay non-executing: clarify intent, explain capabilities, summarize context, and guide the user to Open a .rdc capture when execution is needed.',
    'Do not claim to be the RDC Debugger, do not claim that RenderDoc analysis has started, and do not use tool or shell capabilities.',
  ].join(' '),
  'rdc-debugger': 'You are the RDC Debugger orchestrator. Coordinate the workflow, keep the run truthful, and drive the next best debugging step.',
  'triage_agent': 'You are the triage specialist. Classify the rendering issue, narrow the symptom family, and suggest the right investigation surfaces.',
  'capture_repro_agent': 'You are the capture reproduction specialist. Validate capture quality, frame consistency, and reproducibility anchors.',
  'pass_graph_pipeline_agent': 'You are the pass/pipeline specialist. Analyze render-pass sequencing, pipeline state, and dependency shifts.',
  'pixel_forensics_agent': 'You are the pixel forensics specialist. Explain visible corruption with concrete pixel-, target-, and event-level evidence.',
  'shader_ir_agent': 'You are the shader IR specialist. Inspect shader source, compiled IR, and precision or replacement risks.',
  'driver_device_agent': 'You are the driver/device specialist. Compare backend, device, and driver specific behavior and identify remote-runtime risks.',
  'skeptic_agent': 'You are the skeptic. Challenge weak claims and reject conclusions not proven by the evidence chain.',
  'curator_agent': 'You are the curator. Turn accepted evidence into a structured final report and operator-ready summary.',
};

const DEFAULT_AGENT_TOOLS: Record<AgentRole, string[]> = {
  'ask_agent': [],
  'rdc-debugger': ['ui.ask_user_question', 'rd.core.*', 'rd.session.*', 'rd.capture.*', 'rd.remote.*'],
  'triage_agent': ['rd.session.get_context', 'rd.event.get_action_tree', 'rd.macro.summarize_frame'],
  'capture_repro_agent': ['rd.capture.get_info', 'rd.capture.list_frames', 'rd.context.snapshot'],
  'pass_graph_pipeline_agent': ['rd.pipeline.get_state_summary', 'rd.pipeline.get_output_targets', 'rd.macro.find_state_change_point'],
  'pixel_forensics_agent': ['rd.macro.explain_pixel', 'rd.texture.get_pixel_value', 'rd.export.screenshot'],
  'shader_ir_agent': ['rd.shader.get_disassembly', 'rd.shader.debug_start'],
  'driver_device_agent': ['rd.session.get_context', 'rd.remote.connect', 'rd.remote.ping', 'rd.remote.list_targets'],
  'skeptic_agent': [],
  'curator_agent': [],
};

const DEFAULT_STAGE_POLICIES: StagePolicy[] = [
  {
    id: 'stage.preflight',
    label: 'Preflight',
    stage: 'preflight',
    phase: 'planner',
    agentPromptId: 'agent.rdc-debugger',
    systemPrompt: 'Verify runtime prerequisites, capture availability, and operator configuration before the run starts.',
    notes: 'Fail early on invalid runtime preconditions.',
    toolPolicy: { allowGroups: ['core', 'session', 'capture', 'remote'] },
  },
  {
    id: 'stage.entry_gate',
    label: 'Entry Gate',
    stage: 'entry_gate',
    phase: 'planner',
    agentPromptId: 'agent.rdc-debugger',
    systemPrompt: 'Validate entry contract, backend truth, and capture/device compatibility.',
    notes: 'Reject remote/local mismatches and missing providers.',
    toolPolicy: { allowGroups: ['core', 'session', 'capture', 'remote'] },
  },
  {
    id: 'stage.intake_gate',
    label: 'Intake Gate',
    stage: 'intake_gate',
    phase: 'planner',
    agentPromptId: 'agent.rdc-debugger',
    systemPrompt: 'Establish case input, capture references, and canonical intake state for downstream agents.',
    notes: 'Produce the durable intake truth object.',
    toolPolicy: { allowTools: ['ui.ask_user_question'], allowGroups: ['capture', 'session'] },
  },
  {
    id: 'stage.plan',
    label: 'Plan',
    stage: 'plan',
    phase: 'planner',
    agentPromptId: 'agent.rdc-debugger',
    systemPrompt: 'Expand the user goal into a structured investigation plan, hypotheses, and risk map.',
    notes: 'Planner phase.',
    toolPolicy: { allowTools: ['ui.ask_user_question'], allowGroups: ['core', 'session'] },
  },
  {
    id: 'stage.speclist',
    label: 'Speclist',
    stage: 'speclist',
    phase: 'planner',
    agentPromptId: 'agent.rdc-debugger',
    systemPrompt: 'Produce specialist briefs, ownership boundaries, and tool constraints for each investigator.',
    notes: 'Last planner step before specialist execution.',
    toolPolicy: { allowGroups: ['core', 'session'] },
  },
  {
    id: 'stage.dispatch',
    label: 'Dispatch',
    stage: 'dispatch',
    phase: 'generator',
    agentPromptId: 'agent.rdc-debugger',
    systemPrompt: 'Run specialist work, collect their briefs, and preserve every dispatch and tool trace.',
    notes: 'Generator phase.',
    toolPolicy: { allowGroups: ['core', 'session', 'capture', 'event', 'pipeline', 'texture', 'shader', 'remote', 'macro'] },
  },
  {
    id: 'stage.investigate',
    label: 'Investigate',
    stage: 'investigate',
    phase: 'generator',
    agentPromptId: 'agent.rdc-debugger',
    systemPrompt: 'Synthesize specialist evidence into a concrete diagnosis and next verification target.',
    notes: 'Generator synthesis step.',
    toolPolicy: { allowGroups: ['core', 'session', 'capture', 'event', 'pipeline', 'texture', 'shader', 'remote', 'macro'] },
  },
  {
    id: 'stage.fix_verify',
    label: 'Fix Verify',
    stage: 'fix_verify',
    phase: 'evaluator',
    agentPromptId: 'agent.rdc-debugger',
    systemPrompt: 'Verify the proposed fix against real tool evidence and return pass, retry, or blocked.',
    notes: 'Evaluator oracle step.',
    toolPolicy: { allowGroups: ['core', 'session', 'capture', 'event', 'pipeline', 'texture', 'shader', 'remote', 'macro'] },
  },
  {
    id: 'stage.skepti',
    label: 'Skepti',
    stage: 'skepti',
    phase: 'evaluator',
    agentPromptId: 'agent.skeptic_agent',
    systemPrompt: 'Challenge unsupported claims and require hard evidence for every conclusion.',
    notes: 'Evaluator skeptic step.',
    toolPolicy: { allowGroups: [] },
  },
  {
    id: 'stage.curate',
    label: 'Curate',
    stage: 'curate',
    phase: 'evaluator',
    agentPromptId: 'agent.curator_agent',
    systemPrompt: 'Compile the accepted investigation into a structured, operator-ready final report.',
    notes: 'Evaluator report step.',
    toolPolicy: { allowGroups: [] },
  },
  {
    id: 'stage.finalize',
    label: 'Finalize',
    stage: 'finalize',
    phase: 'evaluator',
    agentPromptId: 'agent.rdc-debugger',
    systemPrompt: 'Finalize only when all gates, evidence, skeptic signoff, and backend truth checks pass.',
    notes: 'Strict close-out gate.',
    toolPolicy: { allowGroups: ['core', 'session'] },
  },
];

const DEFAULT_MODE_PROFILE: ModeProfile = {
  id: DEFAULT_MODE_PROFILE_ID,
  label: 'Debugger Production',
  mode: 'debugger',
  stagePolicies: {
    preflight: 'stage.preflight',
    entry_gate: 'stage.entry_gate',
    intake_gate: 'stage.intake_gate',
    plan: 'stage.plan',
    speclist: 'stage.speclist',
    dispatch: 'stage.dispatch',
    investigate: 'stage.investigate',
    fix_verify: 'stage.fix_verify',
    skepti: 'stage.skepti',
    curate: 'stage.curate',
    finalize: 'stage.finalize',
  },
  defaultAgentPrompts: {
    'rdc-debugger': 'agent.rdc-debugger',
    'triage_agent': 'agent.triage_agent',
    'capture_repro_agent': 'agent.capture_repro_agent',
    'pass_graph_pipeline_agent': 'agent.pass_graph_pipeline_agent',
    'pixel_forensics_agent': 'agent.pixel_forensics_agent',
    'shader_ir_agent': 'agent.shader_ir_agent',
    'driver_device_agent': 'agent.driver_device_agent',
    'skeptic_agent': 'agent.skeptic_agent',
    'curator_agent': 'agent.curator_agent',
  },
};

const DEFAULT_AGENT_PROFILES: AgentPromptProfile[] = Object.entries(DEFAULT_MODEL_ROUTING).map(([agentId, routing]) => ({
  id: `agent.${agentId}`,
  label: agentId,
  agentId: agentId as AgentRole,
  systemPrompt: DEFAULT_AGENT_PROMPTS[agentId as AgentRole],
  modelProvider: routing.provider,
  modelName: routing.model,
  temperature: ['skeptic_agent', 'curator_agent'].includes(agentId) ? 0.2 : 0.3,
  maxTokens: 4096,
  toolPolicy: {
    allowTools: DEFAULT_AGENT_TOOLS[agentId as AgentRole],
  },
}));

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

    this.writeJsonIfMissing(
      path.join(this.getModeProfilesPath(workspaceRoot), `${DEFAULT_MODE_PROFILE.id}.json`),
      DEFAULT_MODE_PROFILE,
    );

    for (const profile of DEFAULT_AGENT_PROFILES) {
      this.writeJsonIfMissing(
        path.join(this.getAgentProfilesPath(workspaceRoot), `${profile.agentId}.json`),
        profile,
      );
    }

    for (const stagePolicy of DEFAULT_STAGE_POLICIES) {
      this.writeJsonIfMissing(
        path.join(this.getStagePoliciesPath(workspaceRoot), `${stagePolicy.stage}.json`),
        stagePolicy,
      );
    }
  }

  normalizeConfiguration(
    configuration: ConfigurationSettings,
    workspaceRoot = appPathService.getWorkspaceRoot(),
  ): ConfigurationSettings {
    this.ensureScaffold(workspaceRoot);
    const availableModeProfiles = this.listModeProfiles(workspaceRoot);
    const hasActiveProfile = availableModeProfiles.some((profile) => profile.id === configuration.activeModeProfileId);
    return {
      ...configuration,
      activeModeProfileId: hasActiveProfile ? configuration.activeModeProfileId : DEFAULT_MODE_PROFILE_ID,
      availableModeProfiles,
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
    ) || DEFAULT_MODE_PROFILE;
    const agentPromptId = modeProfile.defaultAgentPrompts[agentId] || `agent.${agentId}`;
    const agentProfile = this.readJson<AgentPromptProfile>(
      path.join(this.getAgentProfilesPath(workspaceRoot), `${agentId}.json`),
    ) || DEFAULT_AGENT_PROFILES.find((profile) => profile.agentId === agentId)!;
    const stagePolicyId = modeProfile.stagePolicies[stage] || `stage.${stage}`;
    const stagePolicy = this.readJson<StagePolicy>(
      path.join(this.getStagePoliciesPath(workspaceRoot), `${stage}.json`),
    ) || DEFAULT_STAGE_POLICIES.find((policy) => policy.stage === stage)!;

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
        ...(stagePolicy.toolPolicy?.allowTools ?? []),
        ...(agentProfile.toolPolicy?.allowTools ?? []),
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

  private writeJsonIfMissing(filePath: string, value: unknown): void {
    if (fs.existsSync(filePath)) {
      return;
    }
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
  }
}

export const executionProfileService = new ExecutionProfileService();
