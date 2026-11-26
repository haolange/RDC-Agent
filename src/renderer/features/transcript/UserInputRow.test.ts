// @vitest-environment happy-dom
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { localizedTranslator } from '../../i18n/messages';
import { UserInputRow } from './WorkProcessRows';
import { createUserInputRow } from './workProcessDecisionRows';
import type { ConversationToolCall } from '@shared/types/conversation';

vi.mock('../../i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));

const call: ConversationToolCall = {
  id: 'ask-1',
  toolName: 'ask_user',
  status: 'running',
  startedAt: 1,
  userInputQuestions: [
    { questionId: 'capture', prompt: 'Which capture?', options: [], allowFreeform: true },
    { questionId: 'event', prompt: 'Which event?', options: [], allowFreeform: true },
  ],
};

function renderInput(changes: Partial<ConversationToolCall> = {}) {
  const row = createUserInputRow({ ...call, ...changes }, localizedTranslator('en'));
  if (row.type !== 'userInput') throw new Error('Expected an Ask transcript');
  return new DOMParser().parseFromString(renderToStaticMarkup(createElement(UserInputRow, { row })), 'text/html');
}

it('keeps every question and its matching answer visible before and after submission', () => {
  const pending = renderInput();
  const settled = renderInput({
    status: 'complete',
    resultPreview: JSON.stringify({
      answers: [
        { questionId: 'event', answer: 'Event 42' },
        { questionId: 'capture', answer: 'The Android capture' },
      ],
    }),
  });
  for (const document of [pending, settled]) {
    expect(
      [...document.querySelectorAll('.work-process-user-input-transcript-question')].map((el) => el.textContent),
    ).toEqual(['Which capture?', 'Which event?']);
    expect(document.querySelector('button, summary, [aria-expanded], [data-locate]')).toBeNull();
  }
  expect(pending.querySelector('.work-process-user-input-progress')?.textContent).toBe('0/2');
  expect(pending.querySelectorAll('.work-process-user-input-transcript-pending')).toHaveLength(2);
  expect(
    [...settled.querySelectorAll('.work-process-user-input-transcript-answer')].map((el) => el.textContent),
  ).toEqual(['The Android capture', 'Event 42']);
});

it('describes cancelled questions and incomplete records without implying an answer is still due', () => {
  const cancelled = renderInput({ status: 'cancelled' });
  expect(
    [...cancelled.querySelectorAll('.work-process-user-input-transcript-pending')].map((el) => el.textContent),
  ).toEqual(['chat.workProcessUserAnswerMissing', 'chat.workProcessUserAnswerMissing']);
  expect(cancelled.querySelector('.work-process-user-input-progress')).toBeNull();
  const incomplete = renderInput({ userInputQuestions: [] });
  expect(incomplete.querySelector('[role="alert"]')?.textContent).toBe('chat.userInputIncomplete');
  expect(incomplete.querySelector('ol')).toBeNull();
});
