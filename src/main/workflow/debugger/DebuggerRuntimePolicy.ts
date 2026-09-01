import type { AgentRole } from '@shared/types/agent';
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
  shell: 'shell',
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
  output: 'output_register',
  output_register: 'output_register',
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

const SHADER_EDIT_TOOLS = ['rd.shader.edit_and_replace', 'rd.macro.shader_hotfix_validate'];

function expandToken(toolName: string): string[] {
  const expanded = CANONICAL_TOOL_TOKEN_EXPANSIONS[toolName];
  if (expanded) return expanded;
  return [normalizeToolName(toolName)];
}

export function resolveAgentToolAllowlistFromDefinition(
  agentId: AgentRole,
  definitionTools: readonly string[],
): string[] {
  const profileTools = definitionTools.flatMap(expandToken);
  if (profileTools.length === 0) {
    throw new Error(`AGENT_TOOLS_EMPTY: profile ${agentId} has an empty tools list and cannot execute.`);
  }
  return Array.from(new Set(profileTools));
}

export function resolveAgentToolAllowlist(agentId: AgentRole, stage?: WorkflowStage): string[] {
  const settings = settingsService.getAll();
  const runtimeProfile = executionProfileService.resolveAgentRuntimeProfile(settings, stage || 'investigate', agentId);
  const manifest = settings.agents.definitions.find((definition) => definition.id === agentId && definition.enabled);
  const profileTools = manifest
    ? manifest.tools.flatMap(expandToken)
    : runtimeProfile.toolAllowlist?.length
      ? runtimeProfile.toolAllowlist.flatMap(expandToken)
      : [];

  if (profileTools.length === 0) {
    throw new Error(`AGENT_TOOLS_EMPTY: profile ${agentId} has an empty tools list and cannot execute.`);
  }
  return Array.from(new Set(profileTools));
}

export function isBuiltinToolAllowedForAgent(toolName: string, _agentId: AgentRole): boolean {
  const normalizedToolName = normalizeToolName(toolName);
  if (SHADER_EDIT_TOOLS.includes(normalizedToolName)) {
    return false;
  }
  return true;
}

export function isToolAllowedByFrozenAllowlist(
  toolName: string,
  agentId: AgentRole,
  toolAllowlist: readonly string[],
): boolean {
  if (!isBuiltinToolAllowedForAgent(toolName, agentId)) return false;
  const normalizedToolName = normalizeToolName(toolName);
  const expandedAllowlist = toolAllowlist.flatMap(expandToken);
  return matchesAllowlistPattern(normalizedToolName, expandedAllowlist);
}

export function isToolAllowedForAgent(toolName: string, agentId: AgentRole, stage?: WorkflowStage): boolean {
  if (!isBuiltinToolAllowedForAgent(toolName, agentId)) return false;
  return isToolAllowedByFrozenAllowlist(toolName, agentId, resolveAgentToolAllowlist(agentId, stage));
}

export function normalizeToolName(toolName: string): string {
  return RUNTIME_TOOL_ALIASES[toolName] ?? toolName;
}

/**
 * Skill 激活后仍保持可用的元工具：
 * 继续发现/加载其它 skill、向用户提问、搜索工具面不受 skill 收窄影响。
 */
const SKILL_NARROWING_EXEMPT_TOOLS = new Set(['skills', 'skill_read', 'ask_user', 'tool_search']);

function matchesAllowlistPattern(normalizedToolName: string, allowlist: readonly string[]): boolean {
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

/**
 * Skill `allowed-tools` 与 runtime allowlist 求交（DESIGN Skills 条款）：
 * skill 只能收窄、绝不能扩展 effective profile tool set。
 *
 * - 空声明 = 不收窄，原样返回；
 * - 声明支持 canonical token（read/search/git…）、具体工具 id 与 `mcp__*` 前缀模式；
 * - 结果 = runtime allowlist 中被 skill 声明覆盖的条目
 *   ∪ skill 声明中被 runtime 模式（如 `mcp__*`）覆盖的具体工具，
 *   外加元工具豁免（skills/skill_read/ask_user/tool_search）。
 */
export function intersectSkillAllowedTools(
  runtimeAllowlist: readonly string[],
  skillAllowedTools: readonly string[],
): string[] {
  if (skillAllowedTools.length === 0) {
    return [...runtimeAllowlist];
  }
  const requested = skillAllowedTools.flatMap(expandToken).map(normalizeToolName);
  const result = new Set<string>();
  for (const entry of runtimeAllowlist) {
    const normalizedEntry = normalizeToolName(entry);
    if (SKILL_NARROWING_EXEMPT_TOOLS.has(normalizedEntry)) {
      result.add(normalizedEntry);
      continue;
    }
    // runtime 条目被 skill 声明（含模式）覆盖时保留。
    if (matchesAllowlistPattern(normalizedEntry, requested)) {
      result.add(normalizedEntry);
    }
  }
  for (const requestedTool of requested) {
    // skill 声明的具体工具被 runtime 模式（如 mcp__*）覆盖时保留；不能扩展。
    if (!requestedTool.endsWith('*') && matchesAllowlistPattern(requestedTool, runtimeAllowlist)) {
      result.add(requestedTool);
    }
  }
  return Array.from(result);
}

/**
 * 多 skill 激活时工具面：
 * `allowedTools = ∩(skill_i) ∩ runtimeAllowlist`
 *（DESIGN / docs/product/scoped-runtime-resources.md）。
 *
 * - 空声明 skill 不参与收窄；
 * - 若没有任何 skill 声明非空 allowed-tools，返回 null（表示不启用 skill 收窄层）；
 * - 非 null 时调用方应把结果当作最终 skill allowlist（已含元工具豁免）。
 */
export function combineActiveSkillAllowlists(
  runtimeAllowlist: readonly string[],
  skillAllowedToolsList: readonly (readonly string[])[],
): string[] | null {
  let active: Set<string> | null = null;
  for (const skillAllowed of skillAllowedToolsList) {
    if (skillAllowed.length === 0) continue;
    const narrowed = intersectSkillAllowedTools(runtimeAllowlist, skillAllowed);
    if (active === null) {
      active = new Set(narrowed);
      continue;
    }
    // failure-class: security — multi-skill must intersect, never union.
    active = new Set([...active].filter((name) => narrowed.includes(name)));
  }
  return active ? Array.from(active) : null;
}

export function isBuiltinAgentToolId(toolName: string): boolean {
  return BUILTIN_AGENT_TOOL_ID_SET.has(normalizeToolName(toolName));
}
