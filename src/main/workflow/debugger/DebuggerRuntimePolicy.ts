import type { AgentRole } from '@shared/types/agent';
import type { WorkflowStage } from '@shared/types/workflow';
import { executionProfileService } from '../../settings/ExecutionProfileService';
import { settingsService } from '../../settings/SettingsService';

const SPECIALIST_TOOL_BINDINGS: Record<string, string[]> = {
  ask_agent: [],
  triage_agent: [
    'rd.session.get_context',
    'rd.event.get_action_tree',
    'rd.macro.summarize_frame',
  ],
  capture_repro_agent: [
    'rd.capture.get_info',
    'rd.capture.list_frames',
    'rd.context.snapshot',
  ],
  pass_graph_pipeline_agent: [
    'rd.pipeline.get_state_summary',
    'rd.pipeline.get_output_targets',
    'rd.macro.find_state_change_point',
  ],
  pixel_forensics_agent: [
    'rd.macro.explain_pixel',
    'rd.texture.get_pixel_value',
    'rd.export.screenshot',
  ],
  shader_ir_agent: [
    'rd.shader.get_disassembly',
    'rd.shader.debug_start',
  ],
  driver_device_agent: [
    'rd.session.get_context',
    'rd.remote.connect',
    'rd.remote.ping',
    'rd.remote.list_devices',
  ],
  skeptic_agent: [],
  curator_agent: [],
  'rdc-debugger': [],
};

const SHADER_EDIT_TOOLS = ['rd.shader.edit_and_replace', 'rd.macro.shader_hotfix_validate'];

export function resolveAgentToolAllowlist(agentId: AgentRole, stage?: WorkflowStage): string[] {
  const settings = settingsService.getAll();
  const runtimeProfile = executionProfileService.resolveAgentRuntimeProfile(settings, stage || 'investigate', agentId);
  if (runtimeProfile.toolAllowlist?.length) {
    return runtimeProfile.toolAllowlist;
  }
  return SPECIALIST_TOOL_BINDINGS[agentId] ?? [];
}

export function isToolAllowedForAgent(toolName: string, agentId: AgentRole, stage?: WorkflowStage): boolean {
  if (SHADER_EDIT_TOOLS.includes(toolName)) {
    return false;
  }

  const allowlist = resolveAgentToolAllowlist(agentId, stage);
  for (const pattern of allowlist) {
    if (pattern === '*' || pattern === toolName) {
      return true;
    }
    if (pattern.endsWith('.*') && toolName.startsWith(pattern.slice(0, -1))) {
      return true;
    }
  }

  return false;
}
