// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { WorkProcess } from './WorkProcess';
import type {
  ConversationTextItem,
  ConversationThinkingItem,
  ConversationToolCall,
  ConversationWorkTrace,
} from '@shared/types/conversation';
import type { PlanReviewStatus } from '@shared/types/planReview';
vi.mock('../../i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('./PlanReaderHost', () => ({ usePlanReader: () => () => undefined }));

const planCall = (revision: number, status: PlanReviewStatus): ConversationToolCall => ({
  id: `plan-${revision}`,
  toolName: 'plan_artifact',
  status: status === 'awaiting' ? 'running' : 'complete',
  startedAt: revision,
  completedAt: status === 'awaiting' ? undefined : revision + 1,
  displayOrder: revision,
  planReview: {
    status,
    planId: 'plan',
    revision,
    title: `Plan ${revision}`,
    hash: 'h',
    uri: 'session://plans/plan.md',
    summary: ['Find the draw'],
    sections: [],
    handoffOptions: [],
  },
});

it('shows one plan card inside Working through review and revision, then folds once when the turn completes', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const render = (status: ConversationWorkTrace['status'], calls: ConversationToolCall[]) =>
    act(async () =>
      root.render(
        React.createElement(WorkProcess, {
          trace: {
            status,
            updatedAt: 9,
            blocks: [
              {
                id: 'loop',
                kind: 'llm_turn',
                title: 'Loop',
                status: status === 'running' ? 'running' : 'complete',
                startedAt: 1,
                completedAt: status === 'running' ? undefined : 9,
                toolCalls: calls,
              },
            ],
          },
          sessionId: 'plan-session',
          rowKey: 'request:plan:assistant',
        }),
      ),
    );
  const collapsed = () => host.querySelector('.work-process')?.classList.contains('is-collapsed');
  const cards = () => [...host.querySelectorAll('[data-testid="plan-card"]')].map((card) => card.textContent);
  try {
    await render('running', [planCall(1, 'awaiting')]);
    expect(collapsed()).toBe(false);
    expect(cards()).toEqual([expect.stringContaining('Plan 1')]);
    // Feedback returns in the same turn: the rejected revision folds to a shell row and the new one is the only card.
    await render('running', [planCall(1, 'rejected'), planCall(2, 'awaiting')]);
    expect(collapsed()).toBe(false);
    expect(cards()).toEqual([expect.stringContaining('Plan 2')]);
    await render('complete', [planCall(1, 'rejected'), planCall(2, 'approved')]);
    expect(collapsed()).toBe(true);
    // A stop cancels the review: no card is left claiming a decision, and the stopped Working stays open.
    await render('stopped', [planCall(1, 'rejected'), planCall(2, 'cancelled')]);
    expect(collapsed()).toBe(false);
    expect(cards()).toEqual([]);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});

it('restores a main-process tool after folding the process and isolates another message', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const trace: ConversationWorkTrace = {
    status: 'running',
    updatedAt: 2,
    blocks: [
      {
        id: 'loop',
        kind: 'llm_turn',
        title: 'Loop',
        status: 'running',
        startedAt: 1,
        toolCalls: [
          {
            id: 'same-tool-id',
            toolName: 'read_file',
            status: 'complete',
            startedAt: 1,
            completedAt: 2,
            argsPreview: '{"path":"sample.ts"}',
            resultPreview: 'Verified content',
          },
        ],
      },
    ],
  };
  const render = (rowKey: string) =>
    act(async () => root.render(React.createElement(WorkProcess, { trace, sessionId: 'disclosure-session', rowKey })));
  try {
    await render('message-a');
    await act(async () => host.querySelector<HTMLButtonElement>('.work-card-trigger')!.click());
    expect(host.querySelector('.work-card-trigger')?.getAttribute('aria-expanded')).toBe('true');
    await act(async () => host.querySelector<HTMLButtonElement>('.work-process-header')!.click());
    expect(host.querySelector('.work-process')?.classList.contains('is-collapsed')).toBe(true);
    await act(async () => host.querySelector<HTMLButtonElement>('.work-process-header')!.click());
    expect(host.querySelector('.work-card-trigger')?.getAttribute('aria-expanded')).toBe('true');
    await render('message-b');
    expect(host.querySelector('.work-card-trigger')?.getAttribute('aria-expanded')).toBe('false');
    await render('message-a');
    expect(host.querySelector('.work-card-trigger')?.getAttribute('aria-expanded')).toBe('true');
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});

it('folds Working when its turn completes and keeps a manual choice across updates', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const block = {
    id: 'loop',
    kind: 'llm_turn' as const,
    title: 'Loop',
    status: 'running' as const,
    startedAt: 1,
    toolCalls: [{ id: 'read', toolName: 'read_file', status: 'complete' as const, startedAt: 1, completedAt: 2 }],
  };
  const render = (status: ConversationWorkTrace['status'], rowKey: string) =>
    act(async () =>
      root.render(
        React.createElement(WorkProcess, {
          trace: {
            status,
            updatedAt: 3,
            blocks: [
              {
                ...block,
                status: status === 'running' ? 'running' : 'complete',
                completedAt: status === 'running' ? undefined : 3,
              },
            ],
          },
          sessionId: 'collapse-session',
          rowKey,
        }),
      ),
    );
  const collapsed = () => host.querySelector('.work-process')?.classList.contains('is-collapsed');
  try {
    await render('running', 'turn-a');
    expect(collapsed()).toBe(false);
    await render('complete', 'turn-a');
    expect(collapsed()).toBe(true);
    await render('error', 'turn-b');
    expect(collapsed()).toBe(false);
    await act(async () => host.querySelector<HTMLButtonElement>('.work-process-header')!.click());
    expect(collapsed()).toBe(true);
    await render('error', 'turn-b');
    expect(collapsed()).toBe(true);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});

it('keeps streamed text in the same DOM node when its phase is confirmed', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const output: ConversationTextItem = {
    kind: 'text',
    providerOutputRef: { protocol: 'OpenAIResponses', providerBlockKey: 'text:0', contentIndex: 0 },
    text: 'Checking',
    status: 'streaming',
    displayOrder: 1,
  };
  const laterThinking: ConversationThinkingItem = {
    kind: 'thinking',
    providerOutputRef: { protocol: 'OpenAIResponses', providerBlockKey: 'reasoning:1', contentIndex: 1 },
    thinking: { kind: 'summary', source: 'anthropic-thinking', visibility: 'summary', text: 'Later thinking' },
    status: 'streaming',
    displayOrder: 2,
  };
  const trace: ConversationWorkTrace = {
    status: 'running',
    updatedAt: 2,
    blocks: [
      {
        id: 'loop',
        kind: 'llm_turn',
        title: 'Loop',
        status: 'running',
        startedAt: 1,
        toolCalls: [],
        items: [output],
      },
    ],
  };
  const render = () =>
    act(async () =>
      root.render(React.createElement(WorkProcess, { trace: { ...trace }, sessionId: 'session', rowKey: 'a' })),
    );
  try {
    await render();
    const node = host.querySelector('[data-testid="work-process-output"]');
    expect(node?.textContent).toContain('Checking');
    trace.blocks[0].items = [output, laterThinking];
    await render();
    expect(host.querySelector('[data-testid="work-process-output"]')).toBe(node);
    expect(
      [...host.querySelectorAll('[data-testid="work-process-output"], [data-testid="work-process-thinking"]')].map(
        (entry) => entry.getAttribute('data-testid'),
      ),
    ).toEqual(['work-process-output', 'work-process-thinking']);
    trace.blocks[0].items = [
      { ...output, text: 'Checking now', phase: 'commentary', status: 'complete' },
      laterThinking,
    ];
    trace.blocks[0].toolCalls = [
      { id: 'read', toolName: 'read_file', status: 'running', startedAt: 2, executionStartedAt: 2, displayOrder: 3 },
    ];
    await render();
    expect(host.querySelector('[data-testid="work-process-output"]')).toBe(node);
    expect(node?.textContent).toContain('Checking now');
    expect(
      [...host.querySelectorAll('[data-testid="work-process-output"], [data-testid="work-process-tool-call"]')].map(
        (entry) => entry.getAttribute('data-testid'),
      ),
    ).toEqual(['work-process-output', 'work-process-tool-call']);
    expect(host.querySelector('[data-testid="work-process-tool-call"] [data-active-signal="info"]')).not.toBeNull();
    const afterTool = {
      ...output,
      providerOutputRef: { ...output.providerOutputRef, providerBlockKey: 'text:2', contentIndex: 2 },
      text: 'Replay is ready',
      phase: 'commentary' as const,
      displayOrder: 4,
    };
    const unaccepted = {
      ...afterTool,
      providerOutputRef: { ...output.providerOutputRef, providerBlockKey: 'text:3', contentIndex: 3 },
      text: 'Unaccepted answer',
      phase: 'final_answer' as const,
      displayOrder: 5,
    };
    trace.blocks[0].items.push(afterTool, unaccepted);
    await render();
    expect(
      [...host.querySelectorAll('[data-testid="work-process-output"], [data-testid="work-process-tool-call"]')].map(
        (entry) => entry.getAttribute('data-testid'),
      ),
    ).toEqual(['work-process-output', 'work-process-tool-call', 'work-process-output']);
    expect(host.textContent).not.toContain('Unaccepted answer');
    trace.blocks[0].toolCalls[0].approval = { approvalId: 'approval', status: 'pending' };
    await render();
    expect(host.querySelector('[data-testid="work-process-tool-call"] [data-active-signal="info"]')).toBeNull();
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});

it('states how many actions failed and keeps a completed Working with failures open', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const call = (id: string, status: ConversationToolCall['status']): ConversationToolCall => ({
    id,
    toolName: 'read_file',
    status,
    startedAt: 1,
    executionStartedAt: 1,
    completedAt: 2,
    argsPreview: '{"path":"a.ts"}',
    ...(status === 'error' ? { error: 'ENOENT' } : {}),
  });
  const render = (rowKey: string, calls: ConversationToolCall[]) =>
    act(async () =>
      root.render(
        React.createElement(WorkProcess, {
          trace: {
            status: 'complete',
            updatedAt: 3,
            blocks: [
              {
                id: 'loop',
                kind: 'llm_turn',
                title: 'Loop',
                status: 'complete',
                startedAt: 1,
                completedAt: 3,
                toolCalls: calls,
              },
            ],
          },
          sessionId: 'failure-session',
          rowKey,
        }),
      ),
    );
  const header = () => host.querySelector('.work-process-header');
  try {
    await render('request:clean:assistant', [call('read-a', 'complete')]);
    expect(host.querySelector('.work-process')?.classList.contains('is-collapsed')).toBe(true);
    expect(header()?.querySelector('.work-process-meta-failures')).toBeNull();
    await render('request:failed:assistant', [
      call('read-a', 'complete'),
      call('read-b', 'error'),
      call('read-c', 'error'),
    ]);
    expect(host.querySelector('.work-process')?.classList.contains('is-expanded')).toBe(true);
    expect(header()?.querySelector('.work-process-meta-failures')?.textContent).toBe('chat.workProcessFailures');
    expect(header()?.getAttribute('aria-expanded')).toBe('true');
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
