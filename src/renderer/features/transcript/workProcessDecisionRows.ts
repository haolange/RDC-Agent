import type { Translator } from '../../i18n/messages';
import { type ConversationToolCall, type ConversationWorkBlock } from '@shared/types/conversation';
import { type WorkProcessRow, type WorkProcessUserInputItem, type WorkProcessRowStatus } from './workProcessTypes';
import { formatDurationMs, compactText } from './workProcessFormat';
import { parsePreview } from './workProcessContentText';
import { normalizeAskUserAnswers } from '@shared/utils/askUser';
import { getMeaningfulBlockSummary } from './workProcessBlockText';

export const createPlanReviewRow = (call: ConversationToolCall): WorkProcessRow => ({
  type: 'planReview',
  id: call.id,
  status: call.status,
  plan: call.planReview!,
  duration: formatDurationMs(call.startedAt, call.completedAt),
});

export const createPlanReviewShellRow = (call: ConversationToolCall, t: Translator): WorkProcessRow => {
  const rejected = call.planReview?.status === 'rejected';
  const feedback = call.planReview?.decision?.kind === 'reject' ? call.planReview.decision.feedback : call.resultPreview;
  return {
    type: 'tool',
    planReview: call.planReview,
    id: call.id,
    status: call.status,
    verb: call.planReview?.status === 'cancelled' ? t('chat.planShellCancelled')
      : rejected ? t('chat.planShellFeedback') : t('chat.planUpdated'),
    category: t('chat.toolDisplay.plan_artifact.category'),
    icon: 'planArtifact',
    groupKind: 'runtime',
    family: 'runtime',
    toolName: call.toolName,
    target: call.planReview?.title ?? '',
    duration: formatDurationMs(call.startedAt, call.completedAt),
    argsLines: [],
    previewLines: feedback ? [feedback] : [],
    rawLines: [],
    bodyText: feedback || undefined,
  };
};

export const createUserInputRow = (call: ConversationToolCall, t: Translator): WorkProcessRow => {
  const questions = call.userInputQuestions ?? [];
  const incomplete = questions.length === 0;
  const status = call.status === 'cancelled' ? 'cancelled' : incomplete
    ? 'error'
    : call.status === 'complete'
    ? 'complete'
    : call.status === 'error' || call.error
      ? 'error'
      : 'running';
  const result = parsePreview(call.resultPreview);
  const answers = status === 'complete'
    ? normalizeAskUserAnswers(questions, result)
    : [];
  const answerByQuestionId = new Map(answers.map((entry) => [entry.questionId, entry]));
  const items: WorkProcessUserInputItem[] = questions.map((question) => {
    const answer = answerByQuestionId.get(question.questionId);
    return {
      questionId: question.questionId,
      prompt: question.prompt,
      answer: answer?.answer,
    };
  });

  return {
    type: 'userInput',
    id: call.id,
    status,
    verb: status === 'cancelled' ? t('chat.workProcessApprovalCancelled') : incomplete ? t('chat.workProcessAskIncomplete') : status === 'complete' ? t('chat.workProcessAskComplete') : status === 'error' ? t('chat.workProcessAskInterrupted') : t('chat.workProcessAskRunning'),
    questionCount: questions.length,
    items,
    answeredCount: items.filter((item) => Boolean(item.answer)).length,
    incomplete,
    error: incomplete ? undefined : call.error || undefined,
    duration: formatDurationMs(call.startedAt, call.completedAt),
  };
};

export const createApprovalRow = (block: ConversationWorkBlock, t: Translator): WorkProcessRow => {
  const resolvedText = (getMeaningfulBlockSummary(block) || '').trim();
  const isGenericDecision = /^(approved once|user denied)$/i.test(resolvedText);
  const message = isGenericDecision ? '' : compactText(resolvedText, 300);
  const isAutoReview = block.id.includes('auto-review');

  return {
    type: 'approval',
    id: block.id,
    status: block.status,
    verb: getApprovalVerb(block.status, isAutoReview, t),
    message,
    duration: formatDurationMs(block.startedAt, block.completedAt),
    detailLines: [],
    metaLines: [],
  };
};

const getApprovalVerb = (status: WorkProcessRowStatus, isAutoReview: boolean, t: Translator): string => {
  if (status === 'cancelled') return t('chat.workProcessApprovalCancelled');
  if (status === 'error') return isAutoReview ? t('chat.workProcessAutoReviewRejected') : t('chat.workProcessApprovalRejected');
  if (status === 'running' || status === 'pending') return isAutoReview ? t('chat.workProcessAutoReviewPending') : t('chat.workProcessApprovalPending');
  return isAutoReview ? t('chat.workProcessAutoReviewApproved') : t('chat.workProcessApprovalApproved');
};
