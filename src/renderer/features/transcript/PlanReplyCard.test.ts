// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import type { ConversationPlanReview } from '@shared/types/planReview';

vi.mock('../../i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('../../patterns/Markdown/MessageMarkdown', () => ({
  MessageMarkdown: ({ content }: { content: string }) => createElement('div', { 'data-markdown': true }, content),
}));
const readPlan = vi.fn(async () => ({
  markdown: '# Find the stripe\n\nRead the shadow pass before and after.\n\n## Execution references\n- Task',
}));
vi.mock('./usePlanReviewActions', () => ({ usePlanReviewActions: () => ({ readPlan }) }));

it('opens the approved plan in place with its verified text, and folds it again', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const { PlanReplyCard } = await import('./PlanReplyCard');
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const plan = {
    planId: 'p',
    revision: 2,
    uri: 'session://plans/plan.md',
    hash: 'h',
    title: 'Find the stripe',
    summary: ['Read the shadow pass'],
    sections: [],
    handoffOptions: [],
    status: 'approved',
  } as ConversationPlanReview;
  const toggle = () => host.querySelector<HTMLButtonElement>('button[aria-expanded]')!;
  try {
    await act(async () => root.render(createElement(PlanReplyCard, { plan, sessionId: 's' })));
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    expect(readPlan).not.toHaveBeenCalled();

    await act(async () => host.querySelector<HTMLElement>('[data-testid="plan-reply-card"]')!.click());
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    expect(readPlan).toHaveBeenCalledWith({
      sessionId: 's',
      planId: 'p',
      revision: 2,
      uri: 'session://plans/plan.md',
      expectedHash: 'h',
    });
    expect(host.textContent).toContain('Read the shadow pass before and after.');
    expect(host.querySelector('[data-testid="plan-appendix"]')).not.toBeNull();
    expect(document.querySelector('[role="dialog"]')).toBeNull();

    await act(async () => toggle().click());
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    expect(host.querySelector('[data-testid="plan-appendix"]')).toBeNull();
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
