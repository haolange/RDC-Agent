// @vitest-environment happy-dom
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { MessageBubble } from './MessageBubble';
import type { ConversationMessage } from '@shared/types/conversation';
import type { PlanReviewStatus } from '@shared/types/planReview';
vi.mock('./WorkProcess', () => ({ WorkProcess: () => createElement('div', null, 'work-process') }));
vi.mock('./MessageActions', () => ({ MessageActions: () => null }));
vi.mock('./PlanReaderHost', () => ({ usePlanReader: () => () => undefined }));
vi.mock('./HandoffSuggestionRow', () => ({ HandoffSuggestionRow: () => createElement('button', null, 'Continue handoff') }));
vi.mock('../../patterns/Markdown/MessageMarkdown', () => ({ MessageMarkdown: ({ content }: { content: string }) => content }));
vi.mock('../../i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
const base: ConversationMessage = { id: 'm', turnId: 't', sessionId: 's', projectId: 'p', role: 'assistant', content: 'Original result',
  createdAt: 1, status: 'complete', handoffSuggestions: [{ agent: 'helper', label: 'Continue', prompt: 'Go', send: true }] };
it.each<PlanReviewStatus>(['awaiting', 'approved', 'rejected', 'superseded', 'cancelled'])('never repeats %s plan actions from a stored result snapshot', status => {
  const message = { ...base, workTrace: { status: 'complete' as const, updatedAt: 1, blocks: [{
    id: 'b', kind: 'plan_review' as const, title: 'Plan', status: 'complete' as const, startedAt: 1,
    toolCalls: [{ id: 'c', toolName: 'plan_artifact', status: 'complete' as const, startedAt: 1,
      planReview: { status, planId: 'p', revision: 1, title: 'Plan', hash: 'h', uri: 'session://plans/plan.md',
        summary: [], sections: [], handoffOptions: [] } }],
  }] } };
  const html = renderToStaticMarkup(createElement(MessageBubble, { message }));
  expect(html).toContain('Original result');
  expect(html).not.toContain('Continue handoff');
  // The plan card lives in the reply, after Working, only while it is the revision under review or approved.
  expect(html.includes('data-testid="plan-deliverable"')).toBe(status === 'awaiting' || status === 'approved');
  if (status === 'awaiting') expect(html.indexOf('work-process')).toBeLessThan(html.indexOf('plan-deliverable'));
});
it('preserves ordinary handoffs and says once that a reply stopped', () => {
  expect(renderToStaticMarkup(createElement(MessageBubble, { message: base }))).toContain('Continue handoff');
  const html = renderToStaticMarkup(createElement(MessageBubble, { message: { ...base, status: 'stopped' } }));
  expect(html).toContain('Original result');
  expect(html.match(/is-stopped/g)).toHaveLength(1);
  const withWork = renderToStaticMarkup(createElement(MessageBubble, { message: { ...base, status: 'stopped', workTrace: {
    status: 'stopped', updatedAt: 1, blocks: [{ id: 'b', kind: 'llm_turn', title: 'Turn', status: 'cancelled', startedAt: 1, toolCalls: [] }],
  } } }));
  expect(withWork).not.toContain('conversation-message-status-tag is-stopped');
});
it('shows a plan-executing user message as its plan reference and keeps the handoff prompt one disclosure away', () => {
  const user: ConversationMessage = { id: 'u', turnId: 't2', sessionId: 's', projectId: 'p', role: 'user', content: 'Execute the frozen plan.',
    createdAt: 2, status: 'complete' };
  const referenced = renderToStaticMarkup(createElement(MessageBubble, { message: { ...user, planReference: {
    intent: 'execute', planId: 'plan', revision: 3, hash: 'a'.repeat(64), uri: 'session://plans/frozen.md', title: 'Find the draw', agentId: 'general',
  } } }));
  expect(referenced).toContain('data-testid="plan-reference-card"');
  expect(referenced).toContain('Find the draw');
  expect(referenced).toContain('chat.planReference.execute');
  expect(referenced).not.toContain('conversation-bubble-user');
  const plain = renderToStaticMarkup(createElement(MessageBubble, { message: user }));
  expect(plain).toContain('conversation-bubble-user');
  expect(plain).not.toContain('plan-reference-card');
});
