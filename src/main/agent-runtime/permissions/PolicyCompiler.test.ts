import { describe, expect, it } from 'vitest';
import {
  compilePolicyFromRestrictive,
  isToolDeniedByPolicy,
  resolvePolicyApprovalFloor,
} from './PolicyCompiler';

describe('PolicyCompiler', () => {
  it('compiles deniedTools, approval floors, and limits', () => {
    const compiled = compilePolicyFromRestrictive({
      deniedTools: ['Bash', 'web-search'],
      approval: 'mutation',
      approvalFloorByTool: { read_file: 'user' },
      limits: { maxTurns: 12, maxToolCalls: 40, maxSubagents: 2, maxChildDepth: 3 },
    });
    expect(isToolDeniedByPolicy(compiled, 'bash')).toBe(true);
    expect(isToolDeniedByPolicy(compiled, 'web_search')).toBe(true);
    expect(isToolDeniedByPolicy(compiled, 'read_file')).toBe(false);
    expect(compiled.approvalFloorByTool.read_file).toBe('user');
    expect(resolvePolicyApprovalFloor(compiled, 'write_file', 'mutation')).toBe('user');
    expect(compiled.maxTurns).toBe(12);
    expect(compiled.maxToolCalls).toBe(40);
    expect(compiled.maxSubagents).toBe(2);
    expect(compiled.maxChildDepth).toBe(3);
  });

  it('fail-closed on invalid policy fields', () => {
    expect(() => compilePolicyFromRestrictive({
      deniedTools: [1 as unknown as string],
    })).toThrow(/POLICY_INVALID/);
    expect(() => compilePolicyFromRestrictive({
      approval: 'maybe' as 'none',
    })).toThrow(/POLICY_INVALID/);
    expect(() => compilePolicyFromRestrictive({
      limits: { maxTurns: -1 },
    })).toThrow(/POLICY_INVALID/);
  });
});
