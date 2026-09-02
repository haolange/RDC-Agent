/**
 * Concurrency classification for a single tool call.
 * Default is unsafe. Only spec.isConcurrencySafe === true may be concurrent,
 * and hard-serial names / MCP / lease-holding subagents always cut the group.
 */

import type { AgentTool, AgentToolSpec } from './AgentTool';
import type { ToolCall } from '../core/types';

const ALWAYS_SERIAL_TOOL_NAMES = new Set([
  'shell',
  'write_file',
  'edit_file',
  'delete_file',
  'move_file',
  'copy_file',
  'notebook_edit',
  'task_create',
  'task_update',
  'task_stop',
  'rdx_context',
  'rdx_probe',
  'ask_user',
  'agent_handoff',
  'output_register',
  'investigation_write',
]);

export function isAlwaysSerialToolName(toolName: string): boolean {
  const name = toolName.trim();
  if (!name) return true;
  if (name.startsWith('mcp__')) return true;
  return ALWAYS_SERIAL_TOOL_NAMES.has(name);
}

export function isAgentToolSpecConcurrencySafe(spec?: AgentToolSpec): boolean {
  return spec?.isConcurrencySafe === true;
}

/**
 * Classify one call. Missing spec → unsafe.
 * `subagent` is concurrent only when requiresRdxLease === false.
 */
export function isToolCallConcurrencySafe(input: {
  name: string;
  spec?: AgentToolSpec;
  args?: Record<string, unknown>;
}): boolean {
  const name = input.name.trim();
  if (!name || isAlwaysSerialToolName(name)) {
    return false;
  }
  if (name === 'subagent') {
    return input.args?.requiresRdxLease === false;
  }
  return isAgentToolSpecConcurrencySafe(input.spec);
}

export function isAgentToolCallConcurrencySafe(
  tool: Pick<AgentTool, 'name' | 'spec'> | undefined,
  toolCall: Pick<ToolCall, 'name' | 'arguments'>,
): boolean {
  return isToolCallConcurrencySafe({
    name: tool?.name ?? toolCall.name,
    spec: tool?.spec,
    args: toolCall.arguments,
  });
}

export interface ConcurrentToolGroup {
  /** Original call indexes in stable order. */
  callIndexes: number[];
  parallel: boolean;
}

/** Partition a same-turn call list into consecutive safe groups and exclusive unsafe singles. */
export function partitionConsecutiveSafeGroups(
  safeFlags: readonly boolean[],
): ConcurrentToolGroup[] {
  const groups: ConcurrentToolGroup[] = [];
  let current: ConcurrentToolGroup | null = null;
  for (let index = 0; index < safeFlags.length; index += 1) {
    const safe = safeFlags[index] === true;
    if (safe) {
      if (current && current.parallel) {
        current.callIndexes.push(index);
      } else {
        current = { callIndexes: [index], parallel: true };
        groups.push(current);
      }
      continue;
    }
    current = { callIndexes: [index], parallel: false };
    groups.push(current);
  }
  return groups;
}

export function countSubagentCalls(calls: ReadonlyArray<{ name: string }>): number {
  return calls.reduce((sum, call) => (call.name.trim() === 'subagent' ? sum + 1 : sum), 0);
}
