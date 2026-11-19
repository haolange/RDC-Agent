// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import type { ConversationWorkTrace } from '@shared/types/conversation';
import { WorkProcess } from './WorkProcess';
vi.mock('../../i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));

it('restores a main-process tool after folding the process and isolates another message', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  const trace: ConversationWorkTrace = { status: 'running', updatedAt: 2, blocks: [{
    id: 'loop', kind: 'llm_turn', title: 'Loop', status: 'running', startedAt: 1,
    toolCalls: [{ id: 'same-tool-id', toolName: 'read_file', status: 'complete', startedAt: 1, completedAt: 2,
      argsPreview: '{"path":"sample.ts"}', resultPreview: 'Verified content' }],
  }] };
  const render = (messageId: string) => act(async () => root.render(React.createElement(WorkProcess, { trace, sessionId: 'disclosure-session', messageId })));
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
  } finally { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); }
});

it('keeps streamed text in the same DOM node when its phase is confirmed', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  const output = { providerOutputRef: { protocol: 'OpenAIResponses', providerBlockKey: 'text:0', contentIndex: 0 },
    text: 'Checking', status: 'streaming' as const, displayOrder: 1 };
  const trace: ConversationWorkTrace = { status: 'running', updatedAt: 2, blocks: [{
    id: 'loop', kind: 'llm_turn', title: 'Loop', status: 'running', startedAt: 1, toolCalls: [], outputItems: [output],
  }] };
  const render = () => act(async () => root.render(React.createElement(WorkProcess, { trace: { ...trace }, sessionId: 'session', messageId: 'a' })));
  try {
    await render();
    const node = host.querySelector('[data-testid="work-process-output"]');
    expect(node?.textContent).toContain('Checking');
    trace.blocks[0].thinking = { kind: 'summary', source: 'anthropic-thinking', visibility: 'summary', text: 'Later thinking' };
    trace.blocks[0].thinkingStatus = 'streaming';
    trace.blocks[0].thinkingDisplayOrder = 2;
    await render();
    expect(host.querySelector('[data-testid="work-process-output"]')).toBe(node);
    expect([...host.querySelectorAll('[data-testid="work-process-output"], [data-testid="work-process-thinking"]')]
      .map((entry) => entry.getAttribute('data-testid'))).toEqual(['work-process-output', 'work-process-thinking']);
    trace.blocks[0].outputItems = [{ ...output, text: 'Checking now', phase: 'commentary', status: 'complete' }];
    trace.blocks[0].toolCalls = [{ id: 'read', toolName: 'read_file', status: 'running', startedAt: 2, executionStartedAt: 2, displayOrder: 3 }];
    await render();
    expect(host.querySelector('[data-testid="work-process-output"]')).toBe(node);
    expect(node?.textContent).toContain('Checking now');
    expect([...host.querySelectorAll('[data-testid="work-process-output"], [data-testid="work-process-tool-call"]')]
      .map((entry) => entry.getAttribute('data-testid'))).toEqual(['work-process-output', 'work-process-tool-call']);
    expect(host.querySelector('[data-testid="work-process-tool-call"] [data-active-signal="info"]')).not.toBeNull();
    trace.blocks[0].toolCalls[0].approval = { approvalId: 'approval', status: 'pending' };
    await render();
    expect(host.querySelector('[data-testid="work-process-tool-call"] [data-active-signal="info"]')).toBeNull();
  } finally { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); }
});
