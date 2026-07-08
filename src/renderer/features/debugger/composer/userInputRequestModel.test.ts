import { describe, expect, it } from 'vitest';
import type { ConversationAskUserQuestion, ConversationMessage } from '@shared/types/conversation';
import {
  applyCustomDraft,
  applyOptionDraft,
  areAllQuestionsAnswered,
  buildAnswerPayload,
  createRequestFingerprint,
  findPendingUserInput,
  isQuestionAnswered,
  parseAskUserQuestions,
  type PendingUserInputRequest,
  type UserInputAnswerDrafts,
} from './userInputRequestModel';

const questions: ConversationAskUserQuestion[] = [
  {
    questionId: 'direction',
    prompt: 'Where should I start?',
    description: 'Choose the first inspection path.',
    options: [
      { optionId: 'repo', label: 'Repo structure', description: 'Read the repository layout first.' },
      { optionId: 'logs', label: 'Session logs' },
    ],
    allowFreeform: true,
  },
  {
    questionId: 'keyword',
    prompt: 'What keyword should summarize the repo?',
    options: [],
    allowFreeform: true,
  },
];

describe('userInputRequestModel', () => {
  it('parses canonical batch questions from ask_user argsPreview', () => {
    const parsed = parseAskUserQuestions({
      id: 'tool-ask',
      toolName: 'ask_user',
      status: 'running',
      argsPreview: JSON.stringify({ questions }),
      startedAt: 1,
    });

    expect(parsed).toHaveLength(2);
    expect(parsed[0]?.questionId).toBe('direction');
    expect(parsed[0]?.prompt).toBe('Where should I start?');
    expect(parsed[0]?.options[0]).toMatchObject({ optionId: 'repo', label: 'Repo structure' });
  });

  it('builds a complete structured answer payload after option and custom drafts', () => {
    let drafts: UserInputAnswerDrafts = {};
    drafts = applyOptionDraft(drafts, questions[0], questions[0].options[0]);
    drafts = applyCustomDraft(drafts, questions[1], '  graphics\npipeline  ');

    expect(isQuestionAnswered(questions[0], drafts)).toBe(true);
    expect(areAllQuestionsAnswered(questions, drafts)).toBe(true);
    expect(buildAnswerPayload(questions, drafts)).toEqual([
      { questionId: 'direction', answer: 'Repo structure', selectedOptionId: 'repo' },
      { questionId: 'keyword', answer: 'graphics\npipeline', selectedOptionId: undefined },
    ]);
  });

  it('resets state identity when tool call or question fingerprint changes', () => {
    const first: PendingUserInputRequest = {
      sessionId: 'session',
      turnId: 'turn',
      toolCallId: 'tool-1',
      questions,
    };
    const second: PendingUserInputRequest = {
      ...first,
      toolCallId: 'tool-2',
    };
    const revised: PendingUserInputRequest = {
      ...first,
      questions: [{ ...questions[0], prompt: 'Where next?' }],
    };

    expect(createRequestFingerprint(first)).not.toEqual(createRequestFingerprint(second));
    expect(createRequestFingerprint(first)).not.toEqual(createRequestFingerprint(revised));
  });

  it('finds only unresolved ask_user tool calls from active assistant messages', () => {
    const messages = [{
      id: 'message',
      turnId: 'turn',
      sessionId: 'session',
      projectId: null,
      role: 'assistant',
      content: '',
      status: 'streaming',
      createdAt: 1,
      workTrace: {
        status: 'running',
        updatedAt: 1,
        blocks: [{
          id: 'block',
          kind: 'user_input',
          title: 'ask',
          status: 'running',
          startedAt: 1,
          toolCalls: [{
            id: 'tool-ask',
            toolName: 'ask_user',
            status: 'running',
            argsPreview: JSON.stringify({ questions }),
            startedAt: 1,
          }],
        }],
      },
    }] as ConversationMessage[];

    const pending = findPendingUserInput(messages);
    expect(pending).toMatchObject({
      sessionId: 'session',
      turnId: 'turn',
      toolCallId: 'tool-ask',
    });
    expect(pending?.questions.map((question) => question.questionId)).toEqual(['direction', 'keyword']);

    messages[0].workTrace!.blocks[0].toolCalls[0].resultPreview = JSON.stringify({
      answers: [{ questionId: 'direction', answer: 'Repo structure' }],
    });
    expect(findPendingUserInput(messages)).toBeNull();
  });
});
