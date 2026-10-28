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
    expect(host.querySelector('.work-card-trigger')).toBeNull();
    await act(async () => host.querySelector<HTMLButtonElement>('.work-process-header')!.click());
    expect(host.querySelector('.work-card-trigger')?.getAttribute('aria-expanded')).toBe('true');
    await render('message-b');
    expect(host.querySelector('.work-card-trigger')?.getAttribute('aria-expanded')).toBe('false');
    await render('message-a');
    expect(host.querySelector('.work-card-trigger')?.getAttribute('aria-expanded')).toBe('true');
  } finally { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); }
});
