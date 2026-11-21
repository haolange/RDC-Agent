// @vitest-environment happy-dom
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { MessageActions } from './MessageActions';
import type { ConversationMessage } from '@shared/types/conversation';

vi.mock('../../i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('../../hooks/useClipboardBridge', () => ({ useClipboardBridge: () => ({ copyText: async () => true }) }));

const user: ConversationMessage = { id: 'u', turnId: 't', sessionId: 's', projectId: 'p', role: 'user', content: 'Execute the frozen plan.',
  createdAt: 1, status: 'complete' };

it('offers edit and resend only when the bubble can edit the message', () => {
  const editable = renderToStaticMarkup(createElement(MessageActions, { message: user, onEditResend: () => undefined }));
  expect(editable).toContain('aria-label="chat.editResend"');
  // A plan-bound request passes no editor, so only copy remains.
  const planBound = renderToStaticMarkup(createElement(MessageActions, { message: user }));
  expect(planBound).toContain('aria-label="chat.copyMessage"');
  expect(planBound).not.toContain('chat.editResend');
});
