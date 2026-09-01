import { describe, expect, it } from 'vitest';
import {
  isAlwaysSerialToolName,
  isToolCallConcurrencySafe,
  partitionConsecutiveSafeGroups,
} from './toolConcurrency';

describe('toolConcurrency', () => {
  it('treats missing spec as unsafe', () => {
    expect(isToolCallConcurrencySafe({ name: 'mystery' })).toBe(false);
    expect(isToolCallConcurrencySafe({
      name: 'read_file',
      spec: { isReadOnly: true, isConcurrencySafe: true, isDestructive: false, category: 'file', requiresApproval: false },
    })).toBe(true);
  });

  it('forces shell, write, RDX, MCP, ask, handoff, output, and task mutation serial', () => {
    for (const name of [
      'shell',
      'write_file',
      'edit_file',
      'task_create',
      'task_update',
      'task_stop',
      'rdx_context',
      'ask_user',
      'agent_handoff',
      'output_register',
      'mcp__fs__read',
    ]) {
      expect(isAlwaysSerialToolName(name)).toBe(true);
      expect(isToolCallConcurrencySafe({
        name,
        spec: { isReadOnly: true, isConcurrencySafe: true, isDestructive: false, category: 'file', requiresApproval: false },
      })).toBe(false);
    }
  });

  it('allows offline subagent and serializes lease-holding subagent', () => {
    expect(isToolCallConcurrencySafe({
      name: 'subagent',
      args: { requiresRdxLease: false },
    })).toBe(true);
    expect(isToolCallConcurrencySafe({
      name: 'subagent',
      args: { requiresRdxLease: true },
    })).toBe(false);
    expect(isToolCallConcurrencySafe({
      name: 'subagent',
      args: { task: 'x' },
    })).toBe(false);
  });

  it('splits consecutive safe groups around unsafe calls', () => {
    const groups = partitionConsecutiveSafeGroups([true, true, false, true, false, true, true]);
    expect(groups).toEqual([
      { callIndexes: [0, 1], parallel: true },
      { callIndexes: [2], parallel: false },
      { callIndexes: [3], parallel: true },
      { callIndexes: [4], parallel: false },
      { callIndexes: [5, 6], parallel: true },
    ]);
  });
});
