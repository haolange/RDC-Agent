// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import type { ConversationPlanReview } from '@shared/types/planReview';

const markdown = [
  '# 地面阴影条纹从哪次写入开始',
  '',
  '## 打算怎么查',
  '先读阴影 pass 前后的同一区域读数。',
  '',
  '## Execution references',
  '- 前置 Task `task_1795001979310_9f3a2b1c`',
  '',
  '## Task execution requirements',
  '',
  '```json',
  '{"schemaVersion":1}',
  '```',
].join('\n');

vi.mock('../../i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('../../hooks/useElectronApi', () => ({ useElectronApi: () => ({}) }));
vi.mock('../../lib/useModalFocus', () => ({ useModalFocus: () => undefined }));
vi.mock('../../lib/overlayStack', () => ({ useOverlayLayer: () => ({ layerId: 'layer' }) }));
vi.mock('../../lib/useReadingPanelGeometry', () => ({ useReadingPanelGeometry: () => ({ ready: true, anchored: true, style: {} }) }));
vi.mock('../../stores/projectStore', () => ({ useProjectStore: (select: (state: unknown) => unknown) => select({ currentSession: { sessionId: 's' } }) }));
vi.mock('../../stores/planReviewStore', () => ({ usePlanReviewStore: (select: (state: unknown) => unknown) => select({ bySession: {} }) }));
vi.mock('../../patterns/Markdown/MessageMarkdown', () => ({ MessageMarkdown: ({ content }: { content: string }) => createElement('div', { 'data-markdown': true }, content) }));
const actions = { readPlan: async () => ({ markdown }), copyPlan: vi.fn(), saveToProject: vi.fn(), exportPlan: vi.fn() };
vi.mock('./usePlanReviewActions', () => ({ usePlanReviewActions: () => actions }));

it('shows the reader-facing body and keeps the execution appendix collapsed', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const { PlanReviewPanel } = await import('./PlanReviewPanel');
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  const onClose = () => undefined;
  const plan = { planId: 'p', revision: 1, uri: 'session://plans/plan.md', hash: 'h', title: 'Plan', summary: [], sections: [], status: 'awaiting', handoffOptions: [] } as ConversationPlanReview;
  try {
    await act(async () => root.render(createElement(PlanReviewPanel, { plan, onClose })));
    await act(async () => undefined);
    const panel = document.querySelector('[data-testid="plan-review-panel"]')!;
    const [body, references] = [...panel.querySelectorAll('[data-markdown]')].map((node) => node.textContent ?? '');
    expect(body).toContain('先读阴影 pass 前后的同一区域读数');
    expect(body).not.toContain('task_1795001979310_9f3a2b1c');
    const appendix = panel.querySelector<HTMLDetailsElement>('[data-testid="plan-review-appendix"]')!;
    expect(appendix.open).toBe(false);
    expect(appendix.querySelector('summary')?.textContent).toBe('chat.planReviewExecutionReferences');
    expect(references).toContain('task_1795001979310_9f3a2b1c');
    expect(references).toContain('### Task execution requirements');
    expect(references).not.toContain('Execution references');
  } finally {
    await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals();
  }
});
