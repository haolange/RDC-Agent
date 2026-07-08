import type {
  ConversationAskUserAnswer,
  ConversationAskUserOption,
  ConversationAskUserQuestion,
} from '../types/conversation';

export const DEFAULT_ASK_USER_PROMPT = 'The agent needs user input before continuing.';

const asRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
};

const readNonEmptyString = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text ? text : null;
};

const makeUniqueId = (base: string, used: Set<string>): string => {
  let candidate = base;
  let suffix = 2;
  while (used.has(candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  used.add(candidate);
  return candidate;
};

const normalizeOptions = (
  rawOptions: unknown,
  questionId: string,
): ConversationAskUserOption[] => {
  if (!Array.isArray(rawOptions)) return [];
  const used = new Set<string>();
  return rawOptions.flatMap((entry, index): ConversationAskUserOption[] => {
    const record = asRecord(entry);
    if (!record) return [];
    const label = readNonEmptyString(record.label);
    if (!label) return [];
    const optionId = makeUniqueId(
      readNonEmptyString(record.optionId) ?? `${questionId}-option-${index + 1}`,
      used,
    );
    const description = readNonEmptyString(record.description) ?? undefined;
    return [{ optionId, label, description }];
  });
};

export const normalizeAskUserQuestions = (value: unknown): ConversationAskUserQuestion[] => {
  const record = asRecord(value);
  const rawQuestions = Array.isArray(record?.questions) ? record.questions : [];
  const used = new Set<string>();

  return rawQuestions.flatMap((entry, index): ConversationAskUserQuestion[] => {
    const questionRecord = asRecord(entry);
    if (!questionRecord) return [];
    const prompt = readNonEmptyString(questionRecord.prompt);
    if (!prompt) return [];

    const questionId = makeUniqueId(
      readNonEmptyString(questionRecord.questionId) ?? `q${index + 1}`,
      used,
    );
    const options = normalizeOptions(questionRecord.options, questionId);
    const allowFreeform = options.length === 0 || questionRecord.allowFreeform !== false;
    const description = readNonEmptyString(questionRecord.description) ?? undefined;

    return [{
      questionId,
      prompt,
      description,
      options,
      allowFreeform,
    }];
  });
};

export const createFallbackAskUserQuestion = (): ConversationAskUserQuestion => ({
  questionId: 'q1',
  prompt: DEFAULT_ASK_USER_PROMPT,
  options: [],
  allowFreeform: true,
});

export const normalizeAskUserAnswers = (
  questions: ConversationAskUserQuestion[],
  value: unknown,
): ConversationAskUserAnswer[] => {
  const record = asRecord(value);
  const rawAnswers = Array.isArray(record?.answers)
    ? record.answers
    : Array.isArray(value)
      ? value
      : [];
  const questionIds = new Set(questions.map((question) => question.questionId));

  return rawAnswers.flatMap((entry): ConversationAskUserAnswer[] => {
    const answerRecord = asRecord(entry);
    if (!answerRecord) return [];
    const questionId = readNonEmptyString(answerRecord.questionId);
    const answer = readNonEmptyString(answerRecord.answer);
    if (!questionId || !answer || !questionIds.has(questionId)) return [];
    const selectedOptionId = readNonEmptyString(answerRecord.selectedOptionId) ?? undefined;
    return [{ questionId, answer, selectedOptionId }];
  });
};

export const formatAskUserAnswersForToolResult = (
  questions: ConversationAskUserQuestion[],
  answers: ConversationAskUserAnswer[],
): string => {
  const answerByQuestionId = new Map(answers.map((answer) => [answer.questionId, answer.answer]));
  return questions
    .map((question, index) => {
      const answer = answerByQuestionId.get(question.questionId) ?? '';
      return `Q${index + 1}: ${question.prompt}\nA${index + 1}: ${answer}`;
    })
    .join('\n\n');
};
