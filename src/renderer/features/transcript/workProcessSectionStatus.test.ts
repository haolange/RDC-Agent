// @vitest-environment happy-dom
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import type { ConversationWorkBlock, ConversationWorkTrace } from '@shared/types/conversation';
import type { ConversationPlanReview } from '@shared/types/planReview';
import { buildWorkProcessPresentation } from './workProcessTracePresentation';
import { WorkProcessContent } from './WorkProcessContent';
import { PlanReaderHost } from './PlanReaderHost';

vi.mock('../../i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
const plan: ConversationPlanReview = { planId: 'plan', revision: 1, uri: 'session://plans/plan.md',
  hash: 'a'.repeat(64), title: 'Review plan', summary: [], sections: [], status: 'rejected',
  decision: { kind: 'reject', feedback: 'Revise the execution contract' }, handoffOptions: [] };
const loop = (id: string): ConversationWorkBlock => ({ id, title: 'LLM turn', kind: 'llm_turn',
  status: 'complete', startedAt: 1, completedAt: 2, toolCalls: [],
  result: { text: `Progress ${id}`, status: 'complete', outputPhase: 'commentary', stopReason: 'tool_use', toolCallIds: [] } });
const review = (id: string, pending = false): ConversationWorkBlock => ({ id: `review-${id}`,
  title: 'Plan review', kind: 'plan_review', status: pending ? 'running' : 'complete', startedAt: 3,
  toolCalls: [{ id, toolName: 'plan_artifact', status: pending ? 'running' : 'complete', startedAt: 3,
    planReview: pending ? { ...plan, status: 'awaiting', decision: undefined } : plan }] });
function render(blocks: ConversationWorkBlock[]) {
  const trace: ConversationWorkTrace = { status: 'running', updatedAt: 5, blocks };
  const presentation = buildWorkProcessPresentation(trace);
  const html = renderToStaticMarkup(createElement(PlanReaderHost, {
    children: createElement(WorkProcessContent, { presentation }),
  }));
  return { presentation, document: new DOMParser().parseFromString(html, 'text/html') };
}

it('renders both settled sections gray after a rejected plan and a completed read', () => {
  const next = loop('loop-16');
  next.toolCalls = [{ id: 'read', toolName: 'artifact_read', status: 'complete', startedAt: 4, completedAt: 5 }];
  const { presentation, document } = render([loop('loop-15'), review('first'), next]);
  expect(presentation.rows.filter((row) => row.type === 'section').map((row) => row.status))
    .toEqual(['complete', 'complete']);
  expect(document.querySelectorAll('.work-process-section > [data-work-node="structure"]')).toHaveLength(2);
  expect(document.querySelector('[data-work-node="activity"]')).toBeNull();
});

it('keeps pending review lifecycle but does not paint a waiting interaction as active execution', () => {
  const { presentation, document } = render([loop('loop-15'), review('first'), loop('loop-16'), review('second', true)]);
  const sections = presentation.rows.filter((row) => row.type === 'section');
  expect(sections.map((row) => row.status)).toEqual(['complete', 'running']);
  expect(sections[0].steps.map((step) => step.id)).toEqual(['first']);
  expect(sections[1].steps.map((step) => step.id)).toEqual(['second']);
  expect(document.querySelectorAll('.work-process-section > [data-work-node="structure"]')).toHaveLength(2);
  expect(document.querySelector('[data-work-node="activity"]')).toBeNull();
});

it.each(['approved', 'rejected', 'superseded'] as const)('does not treat %s as a completed tool before its receipt arrives', (status) => {
  const pending = review('first', true);
  pending.toolCalls[0].planReview = { ...plan, status };
  const { presentation } = render([loop('loop-15'), pending]);
  expect(presentation.rows.find((row) => row.type === 'section')?.status).toBe('running');
});

it('keeps a real plan tool failure visible as an error', () => {
  const failed = review('first');
  failed.toolCalls[0].status = 'error';
  failed.toolCalls[0].error = 'Failed to persist plan';
  const { presentation } = render([loop('loop-15'), failed]);
  expect(presentation.rows.find((row) => row.type === 'section')?.status).toBe('error');
});
it('renders a cancelled review neutrally and retains its full reader reference', () => {
  const cancelled = review('cancelled');
  cancelled.status = 'cancelled';
  cancelled.toolCalls[0].status = 'cancelled';
  cancelled.toolCalls[0].planReview = { ...plan, status: 'cancelled', decision: undefined };
  const { presentation, document } = render([loop('loop-15'), cancelled]);
  const section = presentation.rows.find(row => row.type === 'section');
  expect(section?.steps[0]).toMatchObject({ type: 'tool', status: 'cancelled', verb: '计划 · 审阅已取消' });
  expect(document.querySelector('.status-error')).toBeNull();
  expect(document.querySelector('.status-running')).toBeNull();
  expect(document.querySelector('button[disabled]')).toBeNull();
  expect(cancelled.toolCalls[0].planReview.hash).toBe(plan.hash);
});
