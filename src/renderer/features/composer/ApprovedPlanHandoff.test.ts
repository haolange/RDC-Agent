// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ApprovedPlanHandoff } from './ApprovedPlanHandoff';
import { useComposerSessionContextStore } from '../../stores/composerSessionContextStore';
import { usePlanReviewStore } from '../../stores/planReviewStore';

vi.mock('../../i18n', () => ({ useI18n: () => ({ t: (key: string) => key, language: 'en' }) }));
let root: Root;
const offer = { agent: 'general', label: 'Execute', prompt: 'Execute plan', send: true, planHash: 'a'.repeat(64) };
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  usePlanReviewStore.getState().reset(); useComposerSessionContextStore.getState().resetForSessionSwitch();
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); document.body.replaceChildren(); vi.unstubAllGlobals(); });

it('requires an explicit click and binds the queued handoff to the displayed approved plan', async () => {
  usePlanReviewStore.getState().accept({ sessionId: 's', projectionVersion: 1, review: null, recoverable: null, approvedHandoff: offer });
  await act(async () => root.render(createElement(ApprovedPlanHandoff, { sessionId: 's', disabled: false })));
  expect(useComposerSessionContextStore.getState().handoffSuggestionRequest).toBeNull();
  const button = document.querySelector<HTMLButtonElement>('button')!;
  expect(button.textContent).toContain('Execute');
  await act(async () => button.click());
  expect(useComposerSessionContextStore.getState().handoffSuggestionRequest).toMatchObject({ sessionId: 's', agentId: 'general', approvedPlanHash: offer.planHash });
  expect(button.disabled).toBe(true);
});

it('hides another session’s action and disables continuation while the composer is busy', async () => {
  usePlanReviewStore.getState().accept({ sessionId: 's', projectionVersion: 1, review: null, recoverable: null, approvedHandoff: offer });
  await act(async () => root.render(createElement(ApprovedPlanHandoff, { sessionId: 'other', disabled: false })));
  expect(document.querySelector('button')).toBeNull();
  await act(async () => root.render(createElement(ApprovedPlanHandoff, { sessionId: 's', disabled: true })));
  expect(document.querySelector<HTMLButtonElement>('button')?.disabled).toBe(true);
});
