import type {
  ConversationAskUserAnswer,
  ConversationAskUserOption,
  ConversationAskUserQuestion,
  ConversationMessage,
  ConversationToolCall,
} from '@shared/types/conversation';

export interface PendingUserInputRequest {
  sessionId: string | null;
  turnId: string;
  toolCallId: string;
  questions: ConversationAskUserQuestion[];
  agentId?: string;
}

export interface UserInputAnswerDraft {
  answer: string;
  selectedOptionId?: string;
}

export type UserInputAnswerDrafts = Record<string, UserInputAnswerDraft>;

const normalizeToolName = (toolName: string): string => toolName.trim().toLowerCase().replace(/[.-]/g, '_');

export const readAskUserQuestions = (call: ConversationToolCall): ConversationAskUserQuestion[] => (
  call.userInputQuestions?.map((question) => ({
    ...question,
    options: question.options.map((option) => ({ ...option })),
  })) ?? []
);

export const findPendingUserInput = (messages: ConversationMessage[]): PendingUserInputRequest | null => {
  const assistantMessages = messages
    .filter((message) => message.role === 'assistant' && (message.status === 'draft' || message.status === 'streaming'))
    .sort((left, right) => right.createdAt - left.createdAt);

  for (const message of assistantMessages) {
    for (const block of message.workTrace?.blocks ?? []) {
      for (const call of block.toolCalls) {
        if (normalizeToolName(call.toolName) !== 'ask_user') continue;
        if (call.status !== 'pending' && call.status !== 'running') continue;
        if (call.resultPreview) continue;

        return {
          sessionId: message.sessionId,
          turnId: message.turnId,
          toolCallId: call.id,
          questions: readAskUserQuestions(call),
          agentId: message.agentId,
        };
      }
    }
  }

  return null;
};

export const createRequestFingerprint = (request: PendingUserInputRequest): string => (
  [
    request.toolCallId,
    ...request.questions.map((question) => [
      question.questionId,
      question.prompt,
      question.description ?? '',
      question.allowFreeform ? 'freeform' : 'fixed',
      ...question.options.map((option) => `${option.optionId}:${option.label}:${option.description ?? ''}`),
    ].join('|')),
  ].join('::')
);

export const isQuestionAnswered = (
  question: ConversationAskUserQuestion,
  drafts: UserInputAnswerDrafts,
): boolean => (drafts[question.questionId]?.answer.trim().length ?? 0) > 0;

export const areAllQuestionsAnswered = (
  questions: ConversationAskUserQuestion[],
  drafts: UserInputAnswerDrafts,
): boolean => questions.every((question) => isQuestionAnswered(question, drafts));

export const applyOptionDraft = (
  drafts: UserInputAnswerDrafts,
  question: ConversationAskUserQuestion,
  option: ConversationAskUserOption,
): UserInputAnswerDrafts => ({
  ...drafts,
  [question.questionId]: {
    answer: option.label,
    selectedOptionId: option.optionId,
  },
});

export const applyCustomDraft = (
  drafts: UserInputAnswerDrafts,
  question: ConversationAskUserQuestion,
  answer: string,
): UserInputAnswerDrafts => ({
  ...drafts,
  [question.questionId]: {
    answer,
  },
});

export const buildAnswerPayload = (
  questions: ConversationAskUserQuestion[],
  drafts: UserInputAnswerDrafts,
): ConversationAskUserAnswer[] => questions.flatMap((question): ConversationAskUserAnswer[] => {
  const draft = drafts[question.questionId];
  const answer = draft?.answer.trim() ?? '';
  if (!answer) return [];
  return [{
    questionId: question.questionId,
    answer,
    selectedOptionId: draft?.selectedOptionId,
  }];
});
