import type { AgentRole } from '@shared/types/agent';
import { isTopLevelAgentId } from '@shared/types/agent';
import type { WorkflowStage } from '@shared/types/workflow';
import {
  BUILTIN_AGENT_TOOL_ID_SET,
  CANONICAL_TOOL_TOKEN_EXPANSIONS,
  diagnoseManifestToolTokens,
  expandCanonicalToolToken,
} from '@shared/constants/agentToolTokens';
import { executionProfileService } from '../../settings/ExecutionProfileService';
import { settingsService } from '../../settings/SettingsService';

export { diagnoseManifestToolTokens, expandCanonicalToolToken };

export const ASK_READONLY_TOOL_ALLOWLIST = [
  'read_file',
  'glob',
  'grep',
  'task_list',
  'task_get',
  'web_fetch',
  'web_search',
  'git_status',
  'git_diff',
  'git_log',
  'tool_search',
  'memory_search',
  'memory_read',
];

const RUNTIME_TOOL_ALIASES: Record<string, string> = {
  read: 'read_file',
  read_file: 'read_file',
  search: 'grep',
  glob: 'glob',
  grep: 'grep',
  web: 'web_fetch',
  web_fetch: 'web_fetch',
  web_search: 'web_search',
  git: 'git_status',
  git_status: 'git_status',
  git_diff: 'git_diff',
  git_log: 'git_log',
  git_add: 'git_add',
  git_unstage: 'git_unstage',
  git_commit: 'git_commit',
  bash: 'bash',
  write: 'write_file',
  write_file: 'write_file',
  edit: 'edit_file',
  edit_file: 'edit_file',
  task_create: 'task_create',
  task_update: 'task_update',
  task_get: 'task_get',
  task_list: 'task_list',
  task_stop: 'task_stop',
  askUser: 'ask_user',
  ask_user: 'ask_user',
  'vscode/askQuestions': 'ask_user',
  agent: 'agent_handoff',
  handoff: 'agent_handoff',
  agent_handoff: 'agent_handoff',
  subagent: 'subagent',
  memory: 'memory_read',
  memory_search: 'memory_search',
  memory_read: 'memory_read',
  memory_write: 'memory_write',
  memory_delete: 'memory_delete',
  planArtifact: 'plan_artifact',
  artifact: 'plan_artifact',
  plan_artifact: 'plan_artifact',
  'vscode/memory': 'memory_read',
  skill: 'skills',
  skills: 'skills',
  skill_read: 'skill_read',
  mcp: 'mcp',
  MCP: 'mcp',
  rdxContext: 'rdx_context',
  rdx: 'rdx_context',
  rdx_context: 'rdx_context',
  tool_search: 'tool_search',
  delete_file: 'delete_file',
  move_file: 'move_file',
  copy_file: 'copy_file',
  notebook_edit: 'notebook_edit',
};

const ASK_DENIED_TOOL_PREFIXES = ['rd.', 'mcp.', 'mcp__'];
const ASK_DENIED_TOOLS = new Set([
  'bash',
  'write',
  'write_file',
  'edit',
  'edit_file',
  'remove',
  'delete',
  'delete_file',
  'move_file',
  'copy_file',
  'notebook_edit',
  'git_add',
  'git_unstage',
  'git_commit',
  'task_create',
  'task_update',
  'task_stop',
  'rdx_context',
  'subagent',
  'memory_write',
  'memory_delete',
  'plan_artifact',
]);

const EXECUTABLE_AGENT_TOOL_ALLOWLIST = [
  ...ASK_READONLY_TOOL_ALLOWLIST,
  'bash',
  'write_file',
  'edit_file',
  'ask_user',
  'agent_handoff',
  'subagent',
  'task_create',
  'task_update',
  'task_get',
  'task_list',
  'task_stop',
  'memory_read',
  'memory_search',
  'memory_write',
  'memory_delete',
  'plan_artifact',
  'skills',
  'skill_read',
  'mcp',
  'mcp__*',
  'rdx_context',
  'git_add',
  'git_unstage',
  'git_commit',
  'delete_file',
  'move_file',
  'copy_file',
  'notebook_edit',
  'tool_search',
];

const SHADER_EDIT_TOOLS = ['rd.shader.edit_and_replace', 'rd.macro.shader_hotfix_validate'];

function expandToken(toolName: string): string[] {
  const expanded = CANONICAL_TOOL_TOKEN_EXPANSIONS[toolName];
  if (expanded) return expanded;
  return [normalizeToolName(toolName)];
}

export function resolveAgentToolAllowlist(agentId: AgentRole, stage?: WorkflowStage): string[] {
  const settings = settingsService.getAll();
  const runtimeProfile = executionProfileService.resolveAgentRuntimeProfile(settings, stage || 'investigate', agentId);
  const manifest = settings.agents.definitions.find((definition) => definition.id === agentId && definition.enabled);
  const profileTools = manifest
    ? manifest.tools.flatMap(expandToken)
    : runtimeProfile.toolAllowlist?.length
      ? runtimeProfile.toolAllowlist.flatMap(expandToken)
      : agentId === 'ask'
        ? ASK_READONLY_TOOL_ALLOWLIST
        : isTopLevelAgentId(agentId)
          ? EXECUTABLE_AGENT_TOOL_ALLOWLIST
          : [];

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
    if (normalizedPattern.endsWith('*') && normalizedToolName.startsWith(normalizedPattern.slice(0, -1))) {
      return true;
    }
  }

  return false;
}

export function normalizeToolName(toolName: string): string {
  return RUNTIME_TOOL_ALIASES[toolName] ?? toolName;
}

function isDeniedAskTool(originalToolName: string, normalizedToolName: string): boolean {
  if (ASK_DENIED_TOOLS.has(originalToolName) || ASK_DENIED_TOOLS.has(normalizedToolName)) {
    return true;
  }
  return ASK_DENIED_TOOL_PREFIXES.some((prefix) => originalToolName.startsWith(prefix) || normalizedToolName.startsWith(prefix));
}

export function isBuiltinAgentToolId(toolName: string): boolean {
  return BUILTIN_AGENT_TOOL_ID_SET.has(normalizeToolName(toolName));
}
