import type { AgentRole } from '@shared/types/agent';
import type { WorkflowStage } from '@shared/types/workflow';
import { executionProfileService } from '../../settings/ExecutionProfileService';
import { settingsService } from '../../settings/SettingsService';

export const ASK_READONLY_TOOL_ALLOWLIST = [
  'read_file',
  'glob',
  'grep',
  'task_list',
  'web_fetch',
  'web_search',
];

const TOOL_ALIASES: Record<string, string> = {
  'primitive.read': 'read_file',
  'primitive.glob': 'glob',
  'primitive.grep': 'grep',
  'primitive.webFetch': 'web_fetch',
  'primitive.webSearch': 'web_search',
  'primitive.task.list': 'task_list',
  'task.list': 'task_list',
  'fs.read': 'read_file',
  'fs.glob': 'glob',
  'fs.grep': 'grep',
};

const ASK_DENIED_TOOL_PREFIXES = ['rd.', 'mcp.'];
const ASK_DENIED_TOOLS = new Set([
  'bash',
  'primitive.bash',
  'write',
  'write_file',
  'primitive.write',
  'edit',
  'edit_file',
  'primitive.edit',
  'remove',
  'delete',
  'task_create',
  'task_update',
]);

const DEBUG_AGENT_SHELL_TOOL_ALLOWLIST = [
  ...ASK_READONLY_TOOL_ALLOWLIST,
  'bash',
];

const SPECIALIST_TOOL_BINDINGS: Record<string, string[]> = {
  ask_agent: ASK_READONLY_TOOL_ALLOWLIST,
  triage_agent: DEBUG_AGENT_SHELL_TOOL_ALLOWLIST,
  capture_repro_agent: DEBUG_AGENT_SHELL_TOOL_ALLOWLIST,
  pass_graph_pipeline_agent: DEBUG_AGENT_SHELL_TOOL_ALLOWLIST,
  pixel_forensics_agent: DEBUG_AGENT_SHELL_TOOL_ALLOWLIST,
  shader_ir_agent: DEBUG_AGENT_SHELL_TOOL_ALLOWLIST,
  driver_device_agent: DEBUG_AGENT_SHELL_TOOL_ALLOWLIST,
  skeptic_agent: DEBUG_AGENT_SHELL_TOOL_ALLOWLIST,
  curator_agent: DEBUG_AGENT_SHELL_TOOL_ALLOWLIST,
  'rdc-debugger': DEBUG_AGENT_SHELL_TOOL_ALLOWLIST,
};

const SHADER_EDIT_TOOLS = ['rd.shader.edit_and_replace', 'rd.macro.shader_hotfix_validate'];

export function resolveAgentToolAllowlist(agentId: AgentRole, stage?: WorkflowStage): string[] {
  const settings = settingsService.getAll();
  const runtimeProfile = executionProfileService.resolveAgentRuntimeProfile(settings, stage || 'investigate', agentId);
  if (runtimeProfile.toolAllowlist?.length) {
    const normalizedProfileTools = runtimeProfile.toolAllowlist.map(normalizeToolName);
    return agentId === 'ask_agent'
      ? Array.from(new Set(normalizedProfileTools))
      : Array.from(new Set([...normalizedProfileTools.filter((toolName) => !toolName.startsWith('rd.')), 'bash']));
  }
  return SPECIALIST_TOOL_BINDINGS[agentId] ?? [];
}

export function isToolAllowedForAgent(toolName: string, agentId: AgentRole, stage?: WorkflowStage): boolean {
  const normalizedToolName = normalizeToolName(toolName);
  if (SHADER_EDIT_TOOLS.includes(normalizedToolName)) {
    return false;
  }
  if (agentId === 'ask_agent' && isDeniedAskTool(toolName, normalizedToolName)) {
    return false;
  }

  const allowlist = resolveAgentToolAllowlist(agentId, stage);
  for (const pattern of allowlist) {
    const normalizedPattern = normalizeToolName(pattern);
    if (normalizedPattern === '*' || normalizedPattern === normalizedToolName) {
      return true;
    }
    if (normalizedPattern.endsWith('.*') && normalizedToolName.startsWith(normalizedPattern.slice(0, -1))) {
      return true;
    }
  }

  return false;
}

export function normalizeToolName(toolName: string): string {
  return TOOL_ALIASES[toolName] ?? toolName;
}

function isDeniedAskTool(originalToolName: string, normalizedToolName: string): boolean {
  if (ASK_DENIED_TOOLS.has(originalToolName) || ASK_DENIED_TOOLS.has(normalizedToolName)) {
    return true;
  }
  return ASK_DENIED_TOOL_PREFIXES.some((prefix) => originalToolName.startsWith(prefix) || normalizedToolName.startsWith(prefix));
}
