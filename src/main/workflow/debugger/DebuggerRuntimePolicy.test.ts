import { describe, expect, it } from 'vitest';
import {
  diagnoseManifestToolTokens,
  expandCanonicalToolToken,
  isToolAllowedForAgent,
} from './DebuggerRuntimePolicy';
import { CANONICAL_TOOL_TOKEN_EXPANSIONS, REJECTED_TOOL_TOKENS } from '@shared/constants/agentToolTokens';

describe('DebuggerRuntimePolicy tool tokens', () => {
  it('expands task token to include task_stop', () => {
    const expanded = expandCanonicalToolToken('task');
    expect(expanded).toContain('task_stop');
    expect(CANONICAL_TOOL_TOKEN_EXPANSIONS.task).toEqual(
      expect.arrayContaining(['task_create', 'task_update', 'task_get', 'task_list', 'task_stop']),
    );
  });

  it('denies task_create for ask agent', () => {
    expect(isToolAllowedForAgent('task_create', 'ask')).toBe(false);
    expect(isToolAllowedForAgent('task_update', 'ask')).toBe(false);
    expect(isToolAllowedForAgent('task_stop', 'ask')).toBe(false);
  });

  it('diagnoses rejected todo and search_codebase tokens', () => {
    const diagnostics = diagnoseManifestToolTokens(['todo', 'search_codebase', 'task']);
    expect(diagnostics.map((entry) => entry.token).sort()).toEqual(['search_codebase', 'todo']);
    expect(REJECTED_TOOL_TOKENS.todo).toMatch(/task/);
    expect(REJECTED_TOOL_TOKENS.search_codebase).toMatch(/removed/);
  });
});
