import { describe, expect, it } from 'vitest';
import type { ConversationMessage, ConversationWorkBlock } from '@shared/types/conversation';
import { collectSessionUsedToolNames } from './rightRailTaskContextResources';

const message = (blocks: ConversationWorkBlock[]): ConversationMessage => ({
  id: 'assistant-1', turnId: 'turn-1', sessionId: 'session-1', projectId: 'project-1', role: 'assistant', content: '', status: 'streaming', createdAt: 1, updatedAt: 1,
  workTrace: { status: 'running', blocks, updatedAt: 1 },
});

describe('right rail task context resources', () => {
  it('uses durable completed and running work-trace tool calls, including nested blocks', () => {
    const tools = collectSessionUsedToolNames([message([{
      id: 'loop', kind: 'llm_turn', title: 'Loop', status: 'complete', toolCalls: [
        { id: 'one', toolName: 'rdx_context', status: 'complete', startedAt: 1 },
        { id: 'two', toolName: 'glob', status: 'pending', startedAt: 2 },
      ], startedAt: 1, children: [{
        id: 'nested', kind: 'llm_turn', title: 'Nested', status: 'running', toolCalls: [
          { id: 'three', toolName: 'web_fetch', status: 'running', startedAt: 3 },
        ], startedAt: 3,
      }],
    }])]);
    expect(tools).toEqual(['rdx_context', 'web_fetch']);
  });
});
