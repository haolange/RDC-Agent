// @vitest-environment happy-dom
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { MessageBubble } from './MessageBubble';
import type { ConversationMessage } from '@shared/types/conversation';
import type { PlanReviewStatus } from '@shared/types/planReview';
vi.mock('./WorkProcess', () => ({ WorkProcess: () => createElement('div', null, 'work-process') }));
vi.mock('./MessageActions', () => ({ MessageActions: () => null }));
vi.mock('./HandoffSuggestionRow', () => ({
  HandoffSuggestionRow: () => createElement('button', null, 'Continue handoff'),
}));
vi.mock('../../patterns/Markdown/MessageMarkdown', () => ({
  MessageMarkdown: ({ content }: { content: string }) => content,
}));
vi.mock('../../i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
const base: ConversationMessage = {
  id: 'm',
  turnId: 't',
  sessionId: 's',
  projectId: 'p',
  role: 'assistant',
  content: 'Original result',
  createdAt: 1,
  status: 'complete',
  handoffSuggestions: [{ agent: 'helper', label: 'Continue', prompt: 'Go', send: true }],
};
it.each<PlanReviewStatus>(['awaiting', 'approved', 'rejected', 'superseded', 'cancelled'])(
  'never repeats %s plan actions from a stored result snapshot',
  (status) => {
    const message = {
      ...base,
      workTrace: {
        status: 'complete' as const,
        updatedAt: 1,
        blocks: [
          {
            id: 'b',
            kind: 'plan_review' as const,
            title: 'Plan',
            status: 'complete' as const,
            startedAt: 1,
            toolCalls: [
              {
                id: 'c',
                toolName: 'plan_artifact',
                status: 'complete' as const,
                startedAt: 1,
                planReview: {
                  status,
                  planId: 'p',
                  revision: 1,
                  title: 'Plan',
                  hash: 'h',
                  uri: 'session://plans/plan.md',
                  summary: [],
                  sections: [],
                  handoffOptions: [],
                },
              },
            ],
          },
        ],
      },
    };
    const html = renderToStaticMarkup(createElement(MessageBubble, { message }));
    expect(html).toContain('Original result');
    expect(html).not.toContain('Continue handoff');
    // Working keeps the reviewable card; a settled reply carries its own card only for the approved plan.
    expect(html).not.toContain('data-testid="plan-card"');
    expect(html.includes('data-testid="plan-reply-card"')).toBe(status === 'approved');
  },
);
it('shows Working while a request runs, and none for a settled reply whose trace holds nothing', () => {
  const draft = {
    ...base,
    content: '',
    status: 'streaming' as const,
    handoffSuggestions: undefined,
    workTrace: { status: 'running' as const, updatedAt: 1, blocks: [] },
  };
  expect(renderToStaticMarkup(createElement(MessageBubble, { message: draft }))).toContain('work-process');
  const settled = {
    ...draft,
    content: 'Answer',
    status: 'complete' as const,
    workTrace: { status: 'complete' as const, updatedAt: 1, blocks: [] },
  };
  expect(renderToStaticMarkup(createElement(MessageBubble, { message: settled }))).not.toContain('work-process');
});

it('preserves ordinary handoffs and says once that a reply stopped', () => {
  expect(renderToStaticMarkup(createElement(MessageBubble, { message: base }))).toContain('Continue handoff');
  const html = renderToStaticMarkup(createElement(MessageBubble, { message: { ...base, status: 'stopped' } }));
  expect(html).toContain('Original result');
  expect(html.match(/is-stopped/g)).toHaveLength(1);
  const withWork = renderToStaticMarkup(
    createElement(MessageBubble, {
      message: {
        ...base,
        status: 'stopped',
        workTrace: {
          status: 'stopped',
          updatedAt: 1,
          blocks: [{ id: 'b', kind: 'llm_turn', title: 'Turn', status: 'cancelled', startedAt: 1, toolCalls: [] }],
        },
      },
    }),
  );
  expect(withWork).not.toContain('conversation-message-status-tag is-stopped');
});
it('says a reply stopped when the app closed instead of the person stopping it', () => {
  const html = (stopCause: ConversationMessage['stopCause']) =>
    renderToStaticMarkup(createElement(MessageBubble, { message: { ...base, status: 'stopped', stopCause } }));
  expect(html('app-shutdown')).toContain('chat.messageStoppedAtShutdown');
  expect(html('user')).toContain('chat.messageStopped<');
});
it('shows a plan-executing handoff as a plain user message and keeps it out of edit-and-resend', () => {
  const user: ConversationMessage = {
    id: 'u',
    turnId: 't2',
    sessionId: 's',
    projectId: 'p',
    role: 'user',
    content: 'Execute the frozen plan.',
    createdAt: 2,
    status: 'complete',
  };
  const referenced = renderToStaticMarkup(
    createElement(MessageBubble, {
      message: {
        ...user,
        planReference: {
          intent: 'execute',
          planId: 'plan',
          revision: 3,
          hash: 'a'.repeat(64),
          uri: 'session://plans/frozen.md',
          title: 'Find the draw',
          agentId: 'general',
        },
      },
    }),
  );
  expect(referenced).toContain('conversation-bubble-user');
  expect(referenced).toContain('Execute the frozen plan.');
  expect(referenced).not.toContain('Find the draw');
  expect(referenced).not.toContain('session://');
});
