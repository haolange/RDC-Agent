import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { ConversationMessage, ConversationToolCall } from '@shared/types/conversation';
import { resolveComposerPendingRequest } from './pendingRequestSelection';
import { ComposerPendingRequest } from './ComposerPendingRequest';

vi.mock('./ToolApprovalRequestPanel', () => ({ ToolApprovalRequestPanel: () => 'approval panel' }));
vi.mock('./PlanReviewRequestPanel', () => ({ PlanReviewRequestPanel: () => 'plan panel' }));
vi.mock('./UserInputRequestPanel', () => ({ UserInputRequestPanel: () => 'question panel' }));

const approval: ConversationToolCall = { id: 'approve', toolName: 'shell', status: 'pending', startedAt: 1,
  approval: { approvalId: 'approval', status: 'pending', risk: 'high' } };
const plan: ConversationToolCall = { id: 'plan', toolName: 'plan_artifact', status: 'running', startedAt: 1,
  planReview: { planId: 'p', revision: 1, uri: 'session://plans/p.md', hash: 'a'.repeat(64), title: 'Plan', summary: [], sections: [], status: 'awaiting', handoffOptions: [] } };
const input: ConversationToolCall = { id: 'ask', toolName: 'ask_user', status: 'running', startedAt: 1,
  userInputQuestions: [{ questionId: 'q', prompt: 'Where?', options: [], allowFreeform: true }] };
const message = (calls: ConversationToolCall[], sessionId = 's'): ConversationMessage => ({
  id: 'm', turnId: 't', sessionId, projectId: 'p', role: 'assistant', status: 'streaming', content: '', createdAt: 1,
  workTrace: { summary: '', status: 'running', updatedAt: 1,
    blocks: [{ id: 'b', kind: 'llm_turn', title: '', status: 'running', startedAt: 1, toolCalls: calls }] },
});

describe('pending Composer request precedence', () => {
  it('chooses approval before plan before questions independent of tool order', () => {
    expect(resolveComposerPendingRequest([message([input, plan, approval])])?.kind).toBe('tool-approval');
    expect(resolveComposerPendingRequest([message([input, plan])])?.kind).toBe('plan-review');
    expect(resolveComposerPendingRequest([message([input])])?.kind).toBe('user-input');
  });
  it('uses only supplied active projection and drops requests when that projection clears', () => {
    expect(resolveComposerPendingRequest([message([approval], 'next')])?.request.sessionId).toBe('next');
    expect(resolveComposerPendingRequest([])).toBeNull();
    expect(resolveComposerPendingRequest([{ ...message([approval, plan, input]), status: 'complete' }])).toBeNull();
  });
  it.each([
    [approval, 'tool-approval', 'approval panel'],
    [plan, 'plan-review', 'plan panel'],
    [input, 'user-input', 'question panel'],
  ] as const)('preserves each pending shell and accent identity', (call, kind, content) => {
    const pending = resolveComposerPendingRequest([message([call])]);
    if (!pending) throw new Error('Expected pending request');
    const html = renderToStaticMarkup(createElement(ComposerPendingRequest, {
      pending, composeAccentStyle: { 'data-dyn-style': 'accent-request' },
    }));
    expect(html).toBe(`<div class="composer-shell composer-shell-${kind}" data-dyn-style="accent-request">${content}</div>`);
  });
});
