// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ComposerPendingRequest } from './ComposerPendingRequest';
import type { ComposerPendingRequestState } from './pendingRequestSelection';

const mock = vi.hoisted(() => ({ approval: vi.fn(), answer: vi.fn() }));
vi.mock('./useToolApprovalSubmit', () => ({ useToolApprovalSubmit: () => mock.approval }));
vi.mock('./useUserInputRequestSubmit', () => ({ useUserInputRequestSubmit: () => mock.answer }));
vi.mock('../../i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
let root: Root;
let host: HTMLDivElement;
const approval: ComposerPendingRequestState = { kind: 'tool-approval', request: {
  sessionId: 's', turnId: 't', approvalId: 'a', toolName: 'shell', question: 'Allow shell?', risk: 'high',
} };
const input: ComposerPendingRequestState = { kind: 'user-input', request: {
  sessionId: 's', turnId: 't', toolCallId: 'c', questions: [
    { questionId: 'q', prompt: 'Choose', options: [{ optionId: 'a', label: 'Alpha' }], allowFreeform: true },
  ],
} };
const render = (pending: ComposerPendingRequestState) => act(async () => {
  root.render(createElement(ComposerPendingRequest, { pending, composeAccentStyle: { 'data-dyn-style': 'test' } }));
});
const click = (selector: string) => act(async () => { host.querySelector<HTMLButtonElement>(selector)!.click(); });
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  mock.approval.mockReset().mockResolvedValue(undefined); mock.answer.mockReset().mockResolvedValue(undefined);
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); host.remove(); });

it.each([true, false])('submits approval=%s once while pending, displays errors and allows retry', async (approved) => {
  let fail!: (error: Error) => void;
  mock.approval.mockImplementationOnce(() => new Promise<void>((_, reject) => { fail = reject; }));
  await render(approval);
  const button = host.querySelector<HTMLButtonElement>(approved ? '.composer-tool-approval-approve' : '.composer-tool-approval-deny')!;
  await act(async () => { button.click(); button.click(); });
  expect(mock.approval).toHaveBeenCalledExactlyOnceWith(approval.request, approved);
  expect(button.disabled).toBe(true);
  await act(async () => fail(new Error('Approval unavailable')));
  expect(host.querySelector('[role="alert"]')?.textContent).toBe('Approval unavailable');
  await act(async () => button.click());
  expect(mock.approval).toHaveBeenCalledTimes(2);
});

it.each([approval, input])('isolates pending $kind failures when the session changes', async (pending) => {
  let fail!: (error: Error) => void;
  (pending.kind === 'tool-approval' ? mock.approval : mock.answer)
    .mockImplementationOnce(() => new Promise<void>((_, reject) => { fail = reject; }));
  await render(pending);
  if (pending.kind === 'user-input') await click('[role="radio"]');
  await click(pending.kind === 'tool-approval' ? '.composer-tool-approval-approve' : '.composer-user-input-submit');
  await render({ ...pending, request: { ...pending.request, sessionId: 'other' } } as ComposerPendingRequestState);
  await act(async () => fail(new Error('Stale failure')));
  expect(host.querySelector('[role="alert"]')).toBeNull();
  if (pending.kind === 'user-input') {
    expect(host.querySelector('[role="radio"]')?.getAttribute('aria-checked')).toBe('false');
    expect(host.querySelector<HTMLButtonElement>('.composer-user-input-submit')!.disabled).toBe(true);
  } else expect(host.querySelector<HTMLButtonElement>('.composer-tool-approval-approve')!.disabled).toBe(false);
});

it('requires an answer, ignores IME/outside focus, and submits the selected answer once', async () => {
  let finish!: () => void;
  mock.answer.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
  await render(input);
  const submit = host.querySelector<HTMLButtonElement>('.composer-user-input-submit')!;
  expect(submit.disabled).toBe(true);
  const option = host.querySelector<HTMLButtonElement>('[role="radio"]')!;
  option.focus();
  await act(async () => option.dispatchEvent(new KeyboardEvent('keydown', { key: '1', isComposing: true, bubbles: true })));
  expect(option.getAttribute('aria-checked')).toBe('false');
  const outside = document.createElement('button'); document.body.append(outside); outside.focus();
  await act(async () => outside.dispatchEvent(new KeyboardEvent('keydown', { key: '1', bubbles: true })));
  expect(option.getAttribute('aria-checked')).toBe('false'); outside.remove();
  await click('[role="radio"]');
  await act(async () => { submit.click(); submit.click(); });
  expect(mock.answer).toHaveBeenCalledTimes(1);
  expect(mock.answer.mock.calls[0][0]).toEqual(input.request);
  expect(mock.answer.mock.calls[0][1]).toEqual([expect.objectContaining({ questionId: 'q', selectedOptionId: 'a' })]);
  await act(async () => finish());
});

it.each([
  [approval, 'turn'], [approval, 'request'], [input, 'turn'], [input, 'request'],
] as const)('keeps a new pending submission locked when the old $0.kind completes after changing $1', async (pending, change) => {
  let finishOld!: () => void;
  let failNew!: (error: Error) => void;
  const submit = pending.kind === 'tool-approval' ? mock.approval : mock.answer;
  submit.mockImplementationOnce(() => new Promise<void>(resolve => { finishOld = resolve; }))
    .mockImplementationOnce(() => new Promise<void>((_, reject) => { failNew = reject; }));
  const selector = pending.kind === 'tool-approval' ? '.composer-tool-approval-approve' : '.composer-user-input-submit';
  await render(pending);
  if (pending.kind === 'user-input') await click('[role="radio"]');
  await click(selector);
  const changed = change === 'turn' ? { turnId: 'next-turn' }
    : pending.kind === 'tool-approval' ? { approvalId: 'next-approval' } : { toolCallId: 'next-question' };
  const next = { ...pending, request: { ...pending.request, ...changed } } as ComposerPendingRequestState;
  await render(next);
  if (pending.kind === 'user-input') await click('[role="radio"]');
  await click(selector);
  expect(submit).toHaveBeenCalledTimes(2);
  expect(submit.mock.calls[1][0]).toEqual(next.request);
  await act(async () => finishOld());
  expect(host.querySelector<HTMLButtonElement>(selector)!.disabled).toBe(true);
  await click(selector); expect(submit).toHaveBeenCalledTimes(2);
  await act(async () => failNew(new Error('New request retry')));
  expect(host.querySelector('[role="alert"]')?.textContent).toBe('New request retry');
  await click(selector); expect(submit).toHaveBeenCalledTimes(3);
});

it('advances batch options, focuses freeform, preserves failed answers and removes the keyboard listener', async () => {
  if (input.kind !== 'user-input') throw new Error('Expected input fixture');
  const remove = vi.spyOn(window, 'removeEventListener');
  const pending: ComposerPendingRequestState = { ...input, request: { ...input.request, questions: [
    ...input.request.questions,
    { questionId: 'details', prompt: 'Explain', options: [], allowFreeform: true },
  ] } };
  await render(pending); await click('[role="radio"]');
  expect(host.textContent).toContain('Explain');
  const textarea = host.querySelector('textarea')!;
  expect(document.activeElement).toBe(textarea);
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, '中文细节');
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true })));
  expect(mock.answer).not.toHaveBeenCalled();
  mock.answer.mockRejectedValueOnce(new Error('Please retry'));
  await click('.composer-user-input-submit');
  expect(host.querySelector('[role="alert"]')?.textContent).toBe('Please retry');
  expect(textarea.value).toBe('中文细节');
  await click('.composer-user-input-submit');
  expect(mock.answer).toHaveBeenCalledTimes(2);
  expect(mock.answer.mock.calls[1][1]).toHaveLength(2);
  remove.mockClear();
  await act(async () => root.render(null));
  expect(remove.mock.calls.some(([type]) => type === 'keydown')).toBe(true);
  remove.mockRestore();
});
