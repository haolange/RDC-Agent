import { agentAccessCeiling, type AgentAccessCeiling } from '../types/agentManifest';
import { BUILTIN_AGENT_TOOL_ID_SET, type BuiltinAgentToolId } from './agentToolTokens';

/**
 * What a tool can affect, independent of who calls it.
 *
 * - `observe`: reads files, the web, catalogs or session state; no side effects.
 * - `record`: writes only session-owned records (tasks, plans, investigation
 *   records, knowledge candidates, delegation and completion bookkeeping).
 * - `mutate`: changes the workspace or user resources (files, git index,
 *   published outputs, persistent memory).
 * - `execute`: runs processes or external integrations (shell, interpreter, MCP).
 */
export type ToolAccess = 'observe' | 'record' | 'mutate' | 'execute';

export const TOOL_ACCESS: Readonly<Record<BuiltinAgentToolId, ToolAccess>> = {
  read_file: 'observe',
  artifact_read: 'observe',
  read_image: 'observe',
  glob: 'observe',
  grep: 'observe',
  git_status: 'observe',
  git_diff: 'observe',
  git_log: 'observe',
  web_fetch: 'observe',
  web_search: 'observe',
  task_get: 'observe',
  task_list: 'observe',
  background_query: 'observe',
  background_result: 'observe',
  ask_user: 'observe',
  memory_search: 'observe',
  memory_read: 'observe',
  skills: 'observe',
  skill_read: 'observe',
  tool_search: 'observe',
  runtime_context: 'observe',
  rdc_probe: 'observe',
  knowledge_browse: 'observe',
  knowledge_search: 'observe',
  knowledge_read: 'observe',
  knowledge_compile: 'observe',
  investigation_schema: 'observe',
  investigation_read: 'observe',
  investigation_list: 'observe',
  task_create: 'record',
  task_update: 'record',
  task_stop: 'record',
  turn_complete: 'record',
  subagent: 'record',
  subagent_report: 'record',
  background_wait: 'record',
  background_message: 'record',
  background_cancel: 'record',
  background_join: 'record',
  plan_artifact: 'record',
  investigation_write: 'record',
  knowledge_candidate_create: 'record',
  write_file: 'mutate',
  edit_file: 'mutate',
  delete_file: 'mutate',
  move_file: 'mutate',
  copy_file: 'mutate',
  notebook_edit: 'mutate',
  git_add: 'mutate',
  git_unstage: 'mutate',
  git_commit: 'mutate',
  output_register: 'mutate',
  memory_write: 'mutate',
  memory_delete: 'mutate',
  shell: 'execute',
  code_interpreter: 'execute',
  mcp: 'execute',
};

const CEILING_ALLOWS: Readonly<Record<AgentAccessCeiling, ReadonlySet<ToolAccess>>> = {
  'read-only': new Set<ToolAccess>(['observe', 'record']),
  'workspace-write': new Set<ToolAccess>(['observe', 'record', 'mutate']),
  full: new Set<ToolAccess>(['observe', 'record', 'mutate', 'execute']),
};

/** Unknown, MCP and wildcard tools are treated as `execute` (fail-closed). */
export function toolAccessOf(toolName: string): ToolAccess {
  const name = toolName.trim();
  return BUILTIN_AGENT_TOOL_ID_SET.has(name) ? TOOL_ACCESS[name as BuiltinAgentToolId] : 'execute';
}

export function ceilingAllowsAccess(ceiling: AgentAccessCeiling, access: ToolAccess): boolean {
  return CEILING_ALLOWS[ceiling].has(access);
}

export function isToolWithinCeiling(toolName: string, ceiling: AgentAccessCeiling): boolean {
  return ceilingAllowsAccess(ceiling, toolAccessOf(toolName));
}

export function filterToolsWithinCeiling(toolNames: readonly string[], ceiling: AgentAccessCeiling): string[] {
  return toolNames.filter((name) => name.endsWith('*') ? ceiling === 'full' : isToolWithinCeiling(name, ceiling));
}

/** Native RDC execution. Omitted ceiling is the profile default (`full`); a missing context is denied. */
export function allowsNativeRdcExecution(context?: { accessCeiling?: AgentAccessCeiling } | null): boolean {
  if (!context) return false;
  return agentAccessCeiling(context) === 'full';
}
