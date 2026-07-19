import { describe, expect, it } from 'vitest';
import {
  diagnoseManifestToolTokens,
  expandCanonicalToolToken,
  intersectSkillAllowedTools,
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

describe('intersectSkillAllowedTools', () => {
  const runtime = ['read_file', 'grep', 'glob', 'bash', 'edit_file', 'mcp__*', 'tool_search', 'ask_user'];

  it('empty declaration keeps the runtime allowlist unchanged', () => {
    expect(intersectSkillAllowedTools(runtime, [])).toEqual(runtime);
  });

  it('narrows the runtime allowlist to declared tools plus meta exemptions', () => {
    const result = intersectSkillAllowedTools(runtime, ['read', 'search']);
    expect(result).toEqual(expect.arrayContaining(['read_file', 'grep', 'glob']));
    // 元工具豁免保留。
    expect(result).toEqual(expect.arrayContaining(['tool_search', 'ask_user']));
    // 未声明的可变工具被收窄掉。
    expect(result).not.toContain('bash');
    expect(result).not.toContain('edit_file');
  });

  it('never expands beyond the runtime allowlist', () => {
    const result = intersectSkillAllowedTools(['read_file', 'grep'], ['bash', 'write', 'read']);
    expect(result).toContain('read_file');
    expect(result).not.toContain('bash');
    expect(result).not.toContain('write_file');
  });

  it('keeps concrete mcp tools covered by a runtime mcp__* pattern', () => {
    const result = intersectSkillAllowedTools(runtime, ['mcp__renderdoc__inspect']);
    expect(result).toContain('mcp__renderdoc__inspect');
    expect(result).not.toContain('bash');
  });
});
