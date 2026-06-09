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

const CANONICAL_TOOL_EXPANSIONS: Record<string, string[]> = {
  read: ['read_file'],
  search: ['glob', 'grep'],
  web: ['web_fetch', 'web_search'],
  bash: ['bash'],
  askUser: ['ask_user'],
  agent: ['agent_handoff'],
  todo: ['task_list'],
  memory: ['memory_read'],
  rdxContext: ['rdx_context'],
};

const RUNTIME_TOOL_ALIASES: Record<string, string> = {
  read_file: 'read_file',
  glob: 'glob',
  grep: 'grep',
  web_fetch: 'web_fetch',
  web_search: 'web_search',
  bash: 'bash',
  task_list: 'task_list',
  ask_user: 'ask_user',
  agent_handoff: 'agent_handoff',
  memory_read: 'memory_read',
  rdx_context: 'rdx_context',
};

const ASK_DENIED_TOOL_PREFIXES = ['rd.', 'mcp.'];
const ASK_DENIED_TOOLS = new Set([
  'bash',
  'write',
  'write_file',
  'edit',
  'edit_file',
  'remove',
  'delete',
  'task_create',
  'task_update',
  'rdx_context',
]);

const EXECUTABLE_AGENT_TOOL_ALLOWLIST = [
  ...ASK_READONLY_TOOL_ALLOWLIST,
  'bash',
  'ask_user',
  'agent_handoff',
  'task_list',
  'memory_read',
  'rdx_context',
];

const SHADER_EDIT_TOOLS = ['rd.shader.edit_and_replace', 'rd.macro.shader_hotfix_validate'];

export function resolveAgentToolAllowlist(agentId: AgentRole, stage?: WorkflowStage): string[] {
  const settings = settingsService.getAll();
  const runtimeProfile = executionProfileService.resolveAgentRuntimeProfile(settings, stage || 'investigate', agentId);
  const profileTools = runtimeProfile.toolAllowlist?.length
    ? runtimeProfile.toolAllowlist.flatMap(expandCanonicalToolToken)
    : agentId === 'ask'
      ? ASK_READONLY_TOOL_ALLOWLIST
      : EXECUTABLE_AGENT_TOOL_ALLOWLIST;

  if (agentId === 'ask') {
    return Array.from(new Set(profileTools.filter((toolName) => !isDeniedAskTool(toolName, normalizeToolName(toolName)))));
  }
  return Array.from(new Set(profileTools));
}

export function isToolAllowedForAgent(toolName: string, agentId: AgentRole, stage?: WorkflowStage): boolean {
  const normalizedToolName = normalizeToolName(toolName);
  if (SHADER_EDIT_TOOLS.includes(normalizedToolName)) {
    return false;
  }
  if (agentId === 'ask' && isDeniedAskTool(toolName, normalizedToolName)) {
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
  return RUNTIME_TOOL_ALIASES[toolName] ?? toolName;
}

function expandCanonicalToolToken(toolName: string): string[] {
  return CANONICAL_TOOL_EXPANSIONS[toolName] ?? [normalizeToolName(toolName)];
}

function isDeniedAskTool(originalToolName: string, normalizedToolName: string): boolean {
  if (ASK_DENIED_TOOLS.has(originalToolName) || ASK_DENIED_TOOLS.has(normalizedToolName)) {
    return true;
  }
  return ASK_DENIED_TOOL_PREFIXES.some((prefix) => originalToolName.startsWith(prefix) || normalizedToolName.startsWith(prefix));
}
