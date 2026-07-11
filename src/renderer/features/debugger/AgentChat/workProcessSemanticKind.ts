import type { ConversationWorkBlock, ConversationToolCall } from '@shared/types/conversation';
import { normalizeToolName, getToolDisplay } from './workProcessToolCatalog';

export type WorkProcessSemanticStepKind =
  | 'explore'
  | 'web'
  | 'change'
  | 'verify'
  | 'interaction'
  | 'collaboration'
  | 'memory'
  | 'diagnostic'
  | 'compaction';

export const SEMANTIC_STEP_TITLES: Record<WorkProcessSemanticStepKind, string> = {
  explore: '探索',
  web: '联网',
  change: '修改',
  verify: '验证',
  interaction: '交互',
  collaboration: '协作',
  memory: '记忆',
  diagnostic: '诊断',
  compaction: '上下文压缩',
};

const GROUP_KIND_TO_SEMANTIC: Record<string, WorkProcessSemanticStepKind> = {
  explore: 'explore',
  search: 'explore',
  web: 'web',
  change: 'change',
  git: 'change',
  command: 'verify',
  interaction: 'interaction',
  collaboration: 'collaboration',
  task: 'collaboration',
  memory: 'memory',
  mcp: 'explore',
  runtime: 'explore',
  diagnostic: 'diagnostic',
};

const TOOL_SEMANTIC_OVERRIDES: Record<string, WorkProcessSemanticStepKind> = {
  grep: 'explore',
  tool_search: 'explore',
  memory_search: 'explore',
  memory_read: 'explore',
  web_search: 'web',
  web_fetch: 'web',
  bash: 'verify',
  ask_user: 'interaction',
  memory_write: 'memory',
  memory_delete: 'memory',
};

export function getToolSemanticStepKind(toolName: string): WorkProcessSemanticStepKind {
  const normalized = normalizeToolName(toolName);
  if (TOOL_SEMANTIC_OVERRIDES[normalized]) {
    return TOOL_SEMANTIC_OVERRIDES[normalized];
  }
  if (normalized.startsWith('git_')) return 'change';
  if (normalized.startsWith('task_')) return 'collaboration';
  if (/^(test|browser|build)/.test(normalized)) return 'verify';
  const display = getToolDisplay(toolName);
  return GROUP_KIND_TO_SEMANTIC[display.groupKind] ?? 'explore';
}

export function getLoopPrimarySemanticKind(block: ConversationWorkBlock): WorkProcessSemanticStepKind {
  if (block.toolCalls.length === 0) return 'explore';
  const counts = new Map<WorkProcessSemanticStepKind, number>();
  for (const call of block.toolCalls) {
    const kind = getToolSemanticStepKind(call.toolName);
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  let bestKind: WorkProcessSemanticStepKind = getToolSemanticStepKind(block.toolCalls[0].toolName);
  let bestCount = 0;
  for (const [kind, count] of counts) {
    if (count > bestCount) {
      bestCount = count;
      bestKind = kind;
    }
  }
  return bestKind;
}

export function countLoopActions(toolCalls: ConversationToolCall[]): number {
  return toolCalls.length;
}
