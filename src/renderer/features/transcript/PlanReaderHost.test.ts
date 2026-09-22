// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { PlanReaderHost, usePlanReader } from './PlanReaderHost';
import type { ConversationPlanReview } from '@shared/types/planReview';

vi.mock('../../stores/projectStore', () => ({ useProjectStore: { getState: () => ({ currentSession: { sessionId: 's' } }) } }));
vi.mock('./PlanReviewPanel', () => ({ PlanReviewPanel: ({ onClose }: { onClose: () => void }) =>
  createElement('button', { onClick: onClose, 'data-reader': true }, 'Close') }));

it('keeps the reader open across transcript remounts and restores the new trigger', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  let frame!: FrameRequestCallback;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frame = callback; return 1; });
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  const plan = { planId: 'p' } as ConversationPlanReview;
  function Trigger() {
    const open = usePlanReader();
    return createElement('button', { 'data-plan-id': 'p', onClick: () => open(plan) }, 'Read');
  }
  const render = (key: string) => act(async () => root.render(createElement(PlanReaderHost, null, createElement(Trigger, { key }))));
  try {
    await render('desktop');
    const original = host.querySelector<HTMLButtonElement>('[data-plan-id]')!;
    await act(async () => original.click());
    await render('drawer');
    expect(original.isConnected).toBe(false);
    expect(host.querySelector('[data-reader]')).not.toBeNull();
    await act(async () => host.querySelector<HTMLButtonElement>('[data-reader]')!.click());
    frame(0);
    expect(document.activeElement).toBe(host.querySelector('[data-plan-id]'));
    expect(host.querySelector('[data-reader]')).toBeNull();
  } finally {
    await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals();
  }
});
