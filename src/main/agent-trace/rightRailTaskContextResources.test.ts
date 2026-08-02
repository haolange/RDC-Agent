import { describe, expect, it } from 'vitest';
import type { ConversationMessage, ConversationWorkBlock } from '@shared/types/conversation';
import type { PromptSegment } from '@shared/types/rdxRuntime';
import { collectSessionTaskContextResources } from './rightRailTaskContextResources';

const message = (blocks: ConversationWorkBlock[]): ConversationMessage => ({
  id: 'assistant-1', turnId: 'turn-1', sessionId: 'session-1', projectId: 'project-1', role: 'assistant', content: '', status: 'streaming', createdAt: 1, updatedAt: 1,
  workTrace: { status: 'running', blocks, updatedAt: 1 },
});

const segment = (input: Partial<PromptSegment> & Pick<PromptSegment, 'id' | 'kind' | 'sourcePath'>): PromptSegment => ({
  scope: 'project',
  sourceHash: input.id + '-hash',
  precedence: 1,
  content: '',
  stability: 'stable',
  tokenEstimate: 1,
  ...input,
});

describe('right rail task context resources', () => {
  it('uses only durable resources from successfully completed tool calls, including nested blocks', () => {
    const resources = collectSessionTaskContextResources({
      messages: [message([{
        id: 'loop', kind: 'llm_turn', title: 'Loop', status: 'complete', toolCalls: [
          {
            id: 'one', toolName: 'read_file', status: 'complete', startedAt: 1,
            resourceRefs: [{ id: 'file:a', kind: 'file', label: 'a.md', path: 'D:/project/a.md' }],
          },
          {
            id: 'two', toolName: 'read_file', status: 'error', startedAt: 2,
            resourceRefs: [{ id: 'file:error', kind: 'file', label: 'error.md' }],
          },
        ], startedAt: 1, children: [{
          id: 'nested', kind: 'llm_turn', title: 'Nested', status: 'complete', toolCalls: [{
            id: 'three', toolName: 'mcp__server__inspect', status: 'complete', startedAt: 3,
            resourceRefs: [{ id: 'mcp:server:inspect', kind: 'mcp', label: 'inspect', summary: 'server' }],
          }], startedAt: 3,
        }],
      }])],
      promptSegments: [],
      projectRoot: 'D:/project',
    });
    expect(resources.map((resource) => resource.label)).toEqual(['a.md', 'inspect']);
  });

  it('projects only frozen preloaded skills and scoped instructions from the prompt', () => {
    const resources = collectSessionTaskContextResources({
      messages: [],
      promptSegments: [
        segment({ id: 'skill:browser', kind: 'preloaded-skill', sourcePath: 'D:/project/.rdx/skills/browser/SKILL.md' }),
        segment({ id: 'instruction:project', kind: 'scoped-instruction', sourcePath: 'D:/project/AGENTS.md' }),
        segment({ id: 'profile:ask', kind: 'agent-profile', sourcePath: 'D:/agents/ask.agent.md' }),
        segment({ id: 'catalog', kind: 'skill-catalog', sourcePath: 'runtime://skills/catalog' }),
      ],
      projectRoot: 'D:/project',
    });
    expect(resources.map((resource) => [resource.kind, resource.label])).toEqual([
      ['skill', 'browser'],
      ['file', 'AGENTS.md'],
    ]);
  });

  it('deduplicates the same path but keeps same-named resources from different paths', () => {
    const resources = collectSessionTaskContextResources({
      messages: [message([{
        id: 'loop', kind: 'llm_turn', title: 'Loop', status: 'complete', startedAt: 1, toolCalls: [
          { id: 'one', toolName: 'read_file', status: 'complete', startedAt: 1, resourceRefs: [{ id: 'one', kind: 'file', label: 'README.md', path: 'D:/one/README.md' }] },
          { id: 'two', toolName: 'read_file', status: 'complete', startedAt: 2, resourceRefs: [{ id: 'two', kind: 'file', label: 'README.md', path: 'D:/two/README.md' }] },
          { id: 'three', toolName: 'read_file', status: 'complete', startedAt: 3, resourceRefs: [{ id: 'three', kind: 'file', label: 'README.md', path: 'D:/one/README.md' }] },
        ],
      }])],
      promptSegments: [],
    });
    expect(resources).toHaveLength(2);
    expect(resources.map((resource) => resource.summary)).toEqual(['one', 'two']);
  });
});