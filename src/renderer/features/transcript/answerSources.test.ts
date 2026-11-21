import { expect, it } from 'vitest';
import { answerSources } from './answerSources';
import type { ConversationWorkTrace } from '@shared/types/conversation';

it('lists pages the turn read, titled from the read and summarized by the search that led there', () => {
  const trace: ConversationWorkTrace = { status: 'complete', updatedAt: 0, blocks: [{
    id: 'turn', kind: 'llm_turn', title: 'LLM turn', status: 'complete', startedAt: 0, toolCalls: [
      { id: 's', toolName: 'web_search', status: 'complete', startedAt: 0, argsPreview: JSON.stringify({ query: 'renderdoc' }),
        resultPreview: JSON.stringify({ ok: true, data: { details: { kind: 'search', results: [{ url: 'https://renderdoc.org/docs/', title: 'Docs', snippet: 'Getting started.' }] } } }),
        resourceRefs: [{ id: 'web:renderdoc', kind: 'web', label: 'renderdoc' }] },
      { id: 'f', toolName: 'web_fetch', status: 'complete', startedAt: 0,
        resourceRefs: [{ id: 'web:https://renderdoc.org/docs', kind: 'web', label: 'RenderDoc Docs', url: 'https://renderdoc.org/docs', summary: 'renderdoc.org' }] },
      { id: 'x', toolName: 'web_fetch', status: 'error', startedAt: 0,
        resourceRefs: [{ id: 'web:https://broken.dev', kind: 'web', label: 'broken.dev', url: 'https://broken.dev' }] },
    ],
  }] };
  expect(answerSources(trace)).toEqual([
    { url: 'https://renderdoc.org/docs', domain: 'renderdoc.org', title: 'RenderDoc Docs', summary: 'Getting started.' },
  ]);
});
