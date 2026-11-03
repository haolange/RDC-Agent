import { describe, expect, it } from 'vitest';
import {
  childScopePrefix,
  ephemeralScopeId,
  isEphemeralScopeId,
  isSubagentScopeId,
  isTransientScopeId,
  rootScopeId,
  subagentScopeId,
} from './executionScope';

describe('execution scope ids', () => {
  it('classifies durable, ephemeral and child scopes', () => {
    const ephemeral = ephemeralScopeId('1234');
    const child = subagentScopeId('session-a', 'exec-1');
    expect(isTransientScopeId('session-a')).toBe(false);
    expect(isEphemeralScopeId(ephemeral)).toBe(true);
    expect(isSubagentScopeId(child)).toBe(true);
    expect(isTransientScopeId(child)).toBe(true);
    expect(isSubagentScopeId(ephemeral)).toBe(false);
  });

  it('resolves the owning root through nested children', () => {
    const nested = subagentScopeId(subagentScopeId('session-a', 'one'), 'two');
    expect(rootScopeId(nested)).toBe('session-a');
    expect(rootScopeId('session-a')).toBe('session-a');
    expect(nested.startsWith(childScopePrefix('session-a'))).toBe(true);
    expect('session-ab::subagent::x'.startsWith(childScopePrefix('session-a'))).toBe(false);
  });
});
