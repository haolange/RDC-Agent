// @vitest-environment happy-dom
import { act, createElement, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useConversationStore } from '../../stores/conversationStore';
import { useComposerRequestReserve } from './useComposerRequestReserve';
import type { ComposerPendingRequestState } from './pendingRequestSelection';
import type { ConversationMessage } from '@shared/types/conversation';

const assistant = (status: ConversationMessage['status']): ConversationMessage => ({
  id: 'assistant',
  turnId: 'turn-plan',
  sessionId: 's',
  projectId: 'p',
  role: 'assistant',
  content: '',
  status,
  createdAt: 1,
  updatedAt: 1,
});
const review = {
  kind: 'plan-review',
  request: {
    sessionId: 's',
    reviewId: 'review',
    agentId: 'mission',
    recovered: false,
    turnId: 'turn-plan',
    toolCallId: 'plan',
    planReview: {
      planId: 'plan',
      revision: 1,
      uri: 'session://plans/p.md',
      hash: 'h',
      title: 'Plan',
      summary: [],
      sections: [],
      status: 'awaiting',
      handoffOptions: [],
    },
  },
} as ComposerPendingRequestState;

let reserved: number[] = [];
const Probe = ({ pending }: { pending: ComposerPendingRequestState | null }) => {
  const [shell, setShell] = useState<HTMLDivElement | null>(null);
  reserved.push(useComposerRequestReserve(pending, shell));
  return pending ? createElement('div', { ref: setShell, 'data-request': true }) : null;
};

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ height: 202 } as DOMRect);
  useConversationStore.getState().reset();
  reserved = [];
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("keeps an answered request's height until its turn ends, and releases it when the turn stops instead", async () => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const render = (pending: ComposerPendingRequestState | null) =>
    act(async () => root.render(createElement(Probe, { pending })));
  try {
    useConversationStore.getState().upsertConversationMessages([assistant('streaming')]);
    await render(review);
    expect(reserved.at(-1)).toBe(0);
    // Feedback sent: the turn keeps running toward the next revision and the Composer keeps the panel's height.
    await render(null);
    expect(reserved.at(-1)).toBe(202);
    await render(review);
    expect(reserved.at(-1)).toBe(0);
    await render(null);
    await act(async () =>
      useConversationStore.getState().upsertConversationMessages([{ ...assistant('complete'), updatedAt: 2 }]),
    );
    expect(reserved.at(-1)).toBe(0);
    // A turn that stops after its request was answered releases the reserve the same way.
    useConversationStore.getState().reset();
    useConversationStore.getState().upsertConversationMessages([assistant('streaming')]);
    await render(review);
    await render(null);
    expect(reserved.at(-1)).toBe(202);
    await act(async () =>
      useConversationStore.getState().upsertConversationMessages([{ ...assistant('stopped'), updatedAt: 2 }]),
    );
    expect(reserved.at(-1)).toBe(0);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
