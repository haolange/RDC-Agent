import fs from 'fs';
import path from 'path';
import YAML from 'yaml';
import { describe, expect, it } from 'vitest';
import {
  combineActiveSkillAllowlists,
  diagnoseManifestToolTokens,
  expandCanonicalToolToken,
  intersectSkillAllowedTools,
  isToolAllowedByFrozenAllowlist,
  resolveAgentToolAllowlistFromDefinition,
} from './DebuggerRuntimePolicy';
import { CANONICAL_TOOL_TOKEN_EXPANSIONS, REJECTED_TOOL_TOKENS } from '@shared/constants/agentToolTokens';

const DEBUGGER_LOOP_SKILLS = [
  'renderdoc-execution',
  'debugger-causal-method',
  'skeptic-review',
  'capture-facts',
  'pixel-forensics',
  'report-composition',
  'capture-preflight',
  'rdx-cli-shell',
  'artifact-provenance',
  'pass-graph-analysis',
  'shader-ir-analysis',
  'resource-versioning',
  'cross-capture-alignment',
  'optimization-experiment',
] as const;

function readSkillAllowedTools(skillId: string): string[] {
  const sourcePath = path.resolve(__dirname, '../../../../resources/agent-runtime/skills', skillId, 'SKILL.md');
  const raw = fs.readFileSync(sourcePath, 'utf8').replace(/^\uFEFF/u, '');
  const match = /^---\r?\n([\s\S]*?)\r?\n---/u.exec(raw);
  const frontmatter = match ? YAML.parse(match[1]) as Record<string, unknown> : {};
  return Array.isArray(frontmatter['allowed-tools'])
    ? frontmatter['allowed-tools'].filter((entry): entry is string => typeof entry === 'string')
    : [];
}

describe('DebuggerRuntimePolicy tool tokens', () => {
  it('expands knowledge token to the five deferred Knowledge tools', () => {
    expect(expandCanonicalToolToken('knowledge')).toEqual([
      'knowledge_browse',
      'knowledge_search',
      'knowledge_read',
      'knowledge_compile',
      'knowledge_candidate_create',
    ]);
    expect(CANONICAL_TOOL_TOKEN_EXPANSIONS.knowledge).toHaveLength(5);
  });

  it('expands task token to include task_stop', () => {
    const expanded = expandCanonicalToolToken('task');
    expect(expanded).toContain('task_stop');
    expect(CANONICAL_TOOL_TOKEN_EXPANSIONS.task).toEqual(
      expect.arrayContaining(['task_create', 'task_update', 'task_get', 'task_list', 'task_stop']),
    );
  });

  it('fail-closes an empty tools list and honors declared tokens only', () => {
    expect(() => resolveAgentToolAllowlistFromDefinition('general', [])).toThrow(/AGENT_TOOLS_EMPTY/);
    const general = resolveAgentToolAllowlistFromDefinition('general', ['task', 'write']);
    expect(isToolAllowedByFrozenAllowlist('task_create', 'general', general)).toBe(true);
    expect(isToolAllowedByFrozenAllowlist('write_file', 'general', general)).toBe(true);
    const mission = resolveAgentToolAllowlistFromDefinition('debugger', ['read', 'task']);
    expect(isToolAllowedByFrozenAllowlist('task_create', 'debugger', mission)).toBe(true);
    expect(isToolAllowedByFrozenAllowlist('write_file', 'debugger', mission)).toBe(false);
  });

  it('diagnoses rejected todo and search_codebase tokens', () => {
    const diagnostics = diagnoseManifestToolTokens(['todo', 'search_codebase', 'bash', 'task']);
    expect(diagnostics.map((entry) => entry.token).sort()).toEqual(['bash', 'search_codebase', 'todo']);
    expect(REJECTED_TOOL_TOKENS.todo).toMatch(/task/);
    expect(REJECTED_TOOL_TOKENS.search_codebase).toMatch(/removed/);
    expect(REJECTED_TOOL_TOKENS.bash).toMatch(/shell/);
  });
});

describe('intersectSkillAllowedTools', () => {
  const runtime = ['read_file', 'grep', 'glob', 'shell', 'edit_file', 'mcp__*', 'tool_search', 'ask_user'];

  it('empty declaration keeps the runtime allowlist unchanged', () => {
    expect(intersectSkillAllowedTools(runtime, [])).toEqual(runtime);
  });

  it('narrows the runtime allowlist to declared tools plus meta exemptions', () => {
    const result = intersectSkillAllowedTools(runtime, ['read', 'search']);
    expect(result).toEqual(expect.arrayContaining(['read_file', 'grep', 'glob']));
    // 元工具豁免保留。
    expect(result).toEqual(expect.arrayContaining(['tool_search', 'ask_user']));
    // 未声明的可变工具被收窄掉。
    expect(result).not.toContain('shell');
    expect(result).not.toContain('edit_file');
  });

  it('never expands beyond the runtime allowlist', () => {
    const result = intersectSkillAllowedTools(['read_file', 'grep'], ['shell', 'write', 'read']);
    expect(result).toContain('read_file');
    expect(result).not.toContain('shell');
    expect(result).not.toContain('write_file');
  });

  it('keeps concrete mcp tools covered by a runtime mcp__* pattern', () => {
    const result = intersectSkillAllowedTools(runtime, ['mcp__renderdoc__inspect']);
    expect(result).toContain('mcp__renderdoc__inspect');
    expect(result).not.toContain('shell');
  });
});

describe('combineActiveSkillAllowlists', () => {
  const runtime = ['read_file', 'grep', 'glob', 'shell', 'edit_file', 'tool_search', 'ask_user', 'skill_read'];

  it('returns null when no skill declares a non-empty allowlist', () => {
    expect(combineActiveSkillAllowlists(runtime, [[], []])).toBeNull();
  });

  it('intersects multiple skill allowlists with the runtime allowlist', () => {
    const combined = combineActiveSkillAllowlists(runtime, [
      ['read', 'search'],
      ['read_file', 'shell'],
    ]);
    expect(combined).not.toBeNull();
    expect(combined).toEqual(expect.arrayContaining(['read_file', 'tool_search', 'ask_user']));
    expect(combined).not.toContain('grep');
    expect(combined).not.toContain('shell');
    expect(combined).not.toContain('edit_file');
  });

  it('ignores empty skill declarations while intersecting the rest', () => {
    const combined = combineActiveSkillAllowlists(runtime, [
      [],
      ['read'],
      ['read_file', 'grep'],
    ]);
    expect(combined).toContain('read_file');
    expect(combined).not.toContain('grep');
  });

  it('keeps Debugger closed-loop tools when method skills are armed together', () => {
    const runtime = [
      'shell',
      'task_create',
      'task_update',
      'task_get',
      'task_list',
      'subagent',
      'investigation_read',
      'investigation_write',
      'investigation_list',
      'artifact_read',
      'rdx_context',
      'read_file',
      'read_image',
      'ask_user',
      'knowledge_browse',
      'knowledge_search',
      'knowledge_read',
      'skill_read',
      'tool_search',
    ];
    const skillLists = DEBUGGER_LOOP_SKILLS.map((skillId) => readSkillAllowedTools(skillId));
    expect(skillLists.every((list) => list.length > 0)).toBe(true);
    const combined = combineActiveSkillAllowlists(runtime, skillLists);
    expect(combined).toEqual(expect.arrayContaining(['subagent', 'task_create', 'shell']));
  });
});
