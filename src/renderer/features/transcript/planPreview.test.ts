import { expect, it } from 'vitest';
import { planPreview } from './planPreview';
import type { ConversationPlanReview } from '@shared/types/planReview';

it('keeps Markdown content without repeating the plan title or leaking its URI', () => {
  const plan = { title: 'Plan', summary: ['Plan', '**Goal**'], uri: 'session://plans/plan.md',
    sections: [{ heading: 'Plan', body: '# Plan\n\nText' }, { heading: 'Inputs', body: '- A\n- B' }] } as ConversationPlanReview;
  const preview = planPreview(plan);
  expect(preview).toBe('**Goal**\n\nText\n\n### Inputs\n\n- A\n- B');
  expect(preview).not.toContain('session://');
});
it('bounds large excerpts and allows genuinely short cards', () => {
  expect(planPreview({ title: 'T', summary: [], sections: [] } as unknown as ConversationPlanReview)).toBe('');
  expect(planPreview({ title: 'T', summary: ['x'.repeat(5000)], sections: [] } as unknown as ConversationPlanReview)).toHaveLength(4000);
});
