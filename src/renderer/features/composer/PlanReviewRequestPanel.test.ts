// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PlanReviewRequestPanel } from './PlanReviewRequestPanel';
import { planReviewRequestKey, type PendingPlanReviewRequest } from './planReviewRequestModel';

const mock = vi.hoisted(() => ({ submit: vi.fn(), modelSave: (_state: { saving: boolean; error?: string }) => {} }));
vi.mock('./usePlanReviewSubmit', () => ({ usePlanReviewSubmit: () => mock.submit }));
vi.mock('./ComposerModelEffortControl', () => ({ ComposerModelEffortControl: (props: {
  onSaveStateChange: typeof mock.modelSave;
}) => { mock.modelSave = props.onSaveStateChange; return createElement('button', null, 'Model'); } }));
vi.mock('../../i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
let root: Root;
let host: HTMLDivElement;
const request: PendingPlanReviewRequest = {
  sessionId: 's', turnId: 't', toolCallId: 'c', planReview: {
    planId: 'p', revision: 1, uri: 'session://plans/plan.md', hash: 'h', title: 'Do not repeat title',
    summary: ['Do not repeat summary'], sections: [], status: 'awaiting',
    handoffOptions: [{ agent: 'general', label: 'Execute' }, { agent: 'custom', label: 'Review with custom' }],
  },
};
const render = (value = request) => act(async () => {
  root.render(createElement(PlanReviewRequestPanel, { key: planReviewRequestKey(value), request: value,
    agentId: 'debugger', currentSession: null }));
});
const click = (selector: string) => act(async () => { host.querySelector<HTMLButtonElement>(selector)!.click(); });
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  mock.submit.mockReset().mockResolvedValue(undefined);
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); host.remove(); });

it('starts compact, offers every declared target and submits the selected one exactly once', async () => {
  let finish!: () => void;
  mock.submit.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
  await render();
  expect(host.textContent).not.toContain('Do not repeat'); expect(host.querySelector('textarea')).not.toBeNull();
  expect(host.querySelector('.handoff-action-row__number')).toBeNull();
  const buttons = host.querySelectorAll<HTMLButtonElement>('.handoff-action-row__button');
  expect(buttons).toHaveLength(2);
  await act(async () => { buttons[1].click(); buttons[1].click(); });
  expect(mock.submit).toHaveBeenCalledExactlyOnceWith(request, { kind: 'approve', handoff: request.planReview.handoffOptions[1] });
  expect(buttons[0].disabled).toBe(true);
  await act(async () => finish());
});

it('renders a single declared target without numbering or an invented alternative', async () => {
  await render({ ...request, planReview: { ...request.planReview, handoffOptions: request.planReview.handoffOptions.slice(0, 1) } });
  expect(host.querySelectorAll('.handoff-action-row__button')).toHaveLength(1);
  expect(host.textContent).not.toContain('Review with custom');
  expect(host.querySelector('.handoff-action-row__number')).toBeNull();
});
it('stops an awaiting plan without approving its handoff', async () => {
  let finish!: () => void;
  const onStop = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
  await act(async () => root.render(createElement(PlanReviewRequestPanel, { request, onStop,
    agentId: 'debugger', currentSession: null })));
  const stop = [...host.querySelectorAll<HTMLButtonElement>('button')]
    .find((button) => button.textContent === 'chat.planReviewStop')!;
  await act(async () => { stop.click(); stop.click(); });
  expect(onStop).toHaveBeenCalledTimes(1);
  expect(mock.submit).not.toHaveBeenCalled();
  expect(host.querySelector<HTMLButtonElement>('.handoff-action-row__button')!.disabled).toBe(true);
  await act(async () => finish());
});
it('always offers revisions, disallows empty feedback and preserves it on failed submission', async () => {
  await render();
  const textarea = host.querySelector('textarea')!;
  expect(host.querySelector<HTMLButtonElement>('.composer-plan-review__revision button')!.disabled).toBe(true);
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, '  Clarify inputs  ');
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  });
  mock.submit.mockRejectedValueOnce(new Error('Retry available'));
  await click('.composer-plan-review__revision button');
  expect(mock.submit).toHaveBeenCalledWith(request, { kind: 'reject', feedback: 'Clarify inputs' });
  expect(textarea.value).toBe('  Clarify inputs  ');
  expect(host.querySelector('[role="alert"]')?.textContent).toBe('Retry available');
  await click('.composer-plan-review__revision button');
  expect(mock.submit).toHaveBeenCalledTimes(2);
});
it.each(['session', 'revision'])('resets editor/error and ignores the previous request failure after %s replacement', async (change) => {
  let fail!: (error: Error) => void;
  mock.submit.mockImplementation(() => new Promise<void>((_, reject) => { fail = reject; }));
  await render(); await click('.handoff-action-row__button');
  await render({ ...request, sessionId: change === 'session' ? 'other' : 's',
    planReview: { ...request.planReview, revision: change === 'revision' ? 2 : 1 } });
  await act(async () => fail(new Error('Old request failed')));
  expect(host.querySelector('textarea')!.value).toBe(''); expect(host.querySelector('[role="alert"]')).toBeNull();
  expect(host.querySelector<HTMLButtonElement>('.handoff-action-row__button')!.disabled).toBe(false);
});

it('holds approval while a model saves, retains failures and still allows stop', async () => {
  const onStop = vi.fn(async () => {});
  await act(async () => root.render(createElement(PlanReviewRequestPanel, {
    request, onStop, agentId: 'debugger', currentSession: null,
  })));
  await act(async () => mock.modelSave({ saving: true }));
  await click('.handoff-action-row__button');
  expect(mock.submit).not.toHaveBeenCalled();
  expect(host.querySelector<HTMLTextAreaElement>('textarea')!.disabled).toBe(true);
  const stop = [...host.querySelectorAll('button')].find((button) => button.textContent === 'chat.planReviewStop')!;
  await act(async () => stop.click());
  expect(onStop).toHaveBeenCalledOnce();
  await act(async () => mock.modelSave({ saving: false, error: 'Save failed' }));
  expect(host.querySelector('[role="alert"]')?.textContent).toBe('Save failed');
  expect(host.querySelector<HTMLButtonElement>('.handoff-action-row__button')!.disabled).toBe(false);
});

it('submits Enter once while Shift+Enter and IME remain editing input', async () => {
  await render();
  const textarea = host.querySelector('textarea')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, '  Revise scope  ');
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  });
  for (const options of [{ shiftKey: true }, { isComposing: true }, { keyCode: 229 }]) {
    await act(async () => textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, ...options })));
  }
  expect(mock.submit).not.toHaveBeenCalled();
  let finish!: () => void;
  mock.submit.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
  await act(async () => {
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  });
  expect(mock.submit).toHaveBeenCalledExactlyOnceWith(request, { kind: 'reject', feedback: 'Revise scope' });
  await act(async () => finish());
});
