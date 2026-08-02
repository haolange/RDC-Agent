import { describe, expect, it } from 'vitest';
import type { ToolCallResult } from '@shared/types/tool';
import { extractConversationToolResourceRefs } from './ConversationToolResourceRefs';

const success = (details: Record<string, unknown>): ToolCallResult => ({
  ok: true,
  data: { details },
  artifacts: [],
  duration_ms: 1,
});

describe('ConversationToolResourceRefs', () => {
  it('extracts concrete file and directory evidence from successful builtin results', () => {
    expect(extractConversationToolResourceRefs('read_file', success({ path: 'D:/project/docs/DESIGN.md' }))).toEqual([
      expect.objectContaining({ kind: 'file', label: 'DESIGN.md', path: 'D:/project/docs/DESIGN.md' }),
    ]);
    expect(extractConversationToolResourceRefs('copy_file', success({
      source: 'D:/project/a.md',
      destination: 'D:/project/docs/a.md',
    }))).toEqual([
      expect.objectContaining({ kind: 'file', label: 'a.md', path: 'D:/project/a.md' }),
      expect.objectContaining({ kind: 'file', label: 'a.md', path: 'D:/project/docs/a.md' }),
    ]);
    expect(extractConversationToolResourceRefs('bash', success({ cwd: 'D:/project' }))).toEqual([
      expect.objectContaining({ kind: 'directory', label: 'project', path: 'D:/project' }),
    ]);
  });

  it('extracts skill, MCP, and web identities without arbitrary payload data', () => {
    expect(extractConversationToolResourceRefs('skill_read', success({
      skillId: 'browser',
      name: 'Browser',
      sourcePath: 'D:/skills/browser/SKILL.md',
      instructions: 'must not be persisted',
    }))).toEqual([{
      id: 'skill:browser',
      kind: 'skill',
      label: 'Browser',
      summary: 'SKILL.md',
      path: 'D:/skills/browser/SKILL.md',
    }]);
    expect(extractConversationToolResourceRefs('mcp__render_doc__inspect_capture', success({ secret: 'no' }))).toEqual([{
      id: 'mcp:render_doc:inspect_capture',
      kind: 'mcp',
      label: 'inspect capture',
      summary: 'render_doc',
    }]);
    expect(extractConversationToolResourceRefs('web_fetch', success({
      url: 'https://example.com/docs',
      title: 'Example docs',
    }))).toEqual([{
      id: 'web:https://example.com/docs',
      kind: 'web',
      label: 'Example docs',
      summary: 'example.com',
      url: 'https://example.com/docs',
    }]);
  });

  it('fails closed for unsuccessful and generic non-resource tools', () => {
    const failed: ToolCallResult = {
      ok: false,
      error: { code: 'FAILED', message: 'no', category: 'execution' },
      duration_ms: 1,
    };
    expect(extractConversationToolResourceRefs('read_file', failed)).toEqual([]);
    expect(extractConversationToolResourceRefs('task_list', success({ count: 3 }))).toEqual([]);
    expect(extractConversationToolResourceRefs('rdx_context', success({ contextId: 'internal' }))).toEqual([]);
  });
});