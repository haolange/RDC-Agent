import { isMissionAgentId } from '../types/agent';
import { expandCanonicalToolToken } from './agentToolTokens';

/**
 * Concrete tool ids Mission planner profiles may keep after token expansion.
 * `task` must drop `output_register`. MCP / shell / interpreter stay out.
 */
export const MISSION_PLAN_ONLY_TOOL_IDS = [
  'read_file',
  'read_image',
  'artifact_read',
  'glob',
  'grep',
  'web_fetch',
  'web_search',
  'ask_user',
  'task_create',
  'task_update',
  'task_get',
  'task_list',
  'task_stop',
  'turn_complete',
  'subagent_report',
  'background_query',
  'background_wait',
  'background_result',
  'background_message',
  'background_cancel',
  'background_join',
  'plan_artifact',
  'investigation_read',
  'investigation_write',
  'investigation_list',
  'knowledge_browse',
  'knowledge_search',
  'knowledge_read',
  'knowledge_compile',
  'knowledge_candidate_create',
  'memory_search',
  'memory_read',
  'tool_search',
  'skills',
  'skill_read',
  'subagent',
  'rdc_context',
  'rdc_probe',
] as const;

export type MissionPlanOnlyToolId = (typeof MISSION_PLAN_ONLY_TOOL_IDS)[number];

export const MISSION_PLAN_ONLY_TOOL_ID_SET = new Set<string>(MISSION_PLAN_ONLY_TOOL_IDS);

export const MISSION_FORBIDDEN_TOOL_IDS = [
  'shell',
  'code_interpreter',
  'write_file',
  'edit_file',
  'git_status',
  'git_diff',
  'git_log',
  'git_add',
  'git_unstage',
  'git_commit',
  'delete_file',
  'move_file',
  'copy_file',
  'notebook_edit',
  'output_register',
  'memory_write',
  'memory_delete',
  'mcp',
] as const;

export const MISSION_FORBIDDEN_TOOL_ID_SET = new Set<string>(MISSION_FORBIDDEN_TOOL_IDS);

const MISSION_FORBIDDEN_TOKENS = new Set([
  'shell',
  'interpreter',
  'code_interpreter',
  'write',
  'edit',
  'git',
  'file-manage',
  'output',
  'output_register',
  'memory-write',
  'mcp',
  'MCP',
]);

export function isMissionPlanOnlyToolId(toolName: string): boolean {
  return MISSION_PLAN_ONLY_TOOL_ID_SET.has(toolName);
}

export function isMissionForbiddenToolId(toolName: string): boolean {
  if (MISSION_FORBIDDEN_TOOL_ID_SET.has(toolName)) return true;
  if (toolName.startsWith('mcp__')) return true;
  return false;
}

export function isMissionProfileId(agentId: string): boolean {
  return isMissionAgentId(agentId);
}

/**
 * Expand manifest tokens, then keep only the Mission plan-only concrete ids.
 * `task` therefore loses `output_register`. Unknown / MCP / mutate tokens drop.
 */
export function expandMissionPlanOnlyTokens(tokens: readonly string[]): string[] {
  const expanded = tokens.flatMap((token) => {
    const trimmed = token.trim();
    if (!trimmed || MISSION_FORBIDDEN_TOKENS.has(trimmed)) return [];
    return expandCanonicalToolToken(trimmed);
  });
  return Array.from(new Set(expanded.filter((id) => isMissionPlanOnlyToolId(id))));
}

export function filterMissionPlanOnlyAllowlist(toolIds: readonly string[]): string[] {
  return Array.from(new Set(
    toolIds.filter((id) => isMissionPlanOnlyToolId(id) && !isMissionForbiddenToolId(id)),
  ));
}
