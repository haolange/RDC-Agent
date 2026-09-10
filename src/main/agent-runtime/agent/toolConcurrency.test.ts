import { describe, expect, it } from 'vitest';
import {
  countSubagentCalls,
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
      'rdx_probe',
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

  it('requires explicit safe dispatch metadata without guessing from Capsule fields', () => {
    expect(isToolCallConcurrencySafe({ name: 'subagent', args: { task: 'x' } })).toBe(false);
    const spec = { orchestration: true, isReadOnly: false, isConcurrencySafe: true, isDestructive: false, category: 'task' as const, requiresApproval: false };
    expect(isToolCallConcurrencySafe({ name: 'subagent', spec, args: { task: 'x' } })).toBe(true);
    expect(isToolCallConcurrencySafe({ name: 'subagent', spec, args: { domainExtensions: { rdx: { requiresLease: true } } } })).toBe(true);
    expect(countSubagentCalls([{ name: 'subagent' }, { name: 'background_wait' }])).toBe(1);
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
