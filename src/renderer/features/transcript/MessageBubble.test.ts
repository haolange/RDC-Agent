// @vitest-environment happy-dom
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import type { ConversationMessage } from '@shared/types/conversation';
import type { PlanReviewStatus } from '@shared/types/planReview';
import { MessageBubble } from './MessageBubble';
vi.mock('./WorkProcess', () => ({ WorkProcess: () => createElement('div', null, 'work-process') }));
vi.mock('./MessageActions', () => ({ MessageActions: () => null }));
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
});
it('preserves ordinary handoffs and original stopped output without a duplicate stop badge', () => {
  expect(renderToStaticMarkup(createElement(MessageBubble, { message: base }))).toContain('Continue handoff');
  const html = renderToStaticMarkup(createElement(MessageBubble, { message: { ...base, status: 'stopped' } }));
  expect(html).toContain('Original result');
  expect(html).not.toContain('is-stopped');
});
