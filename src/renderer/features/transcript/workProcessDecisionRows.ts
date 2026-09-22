import { type ConversationToolCall, type ConversationWorkBlock } from '@shared/types/conversation';
import { type WorkProcessRow, type WorkProcessUserInputItem, type WorkProcessRowStatus } from './workProcessTypes';
import { formatDurationMs, compactText } from './workProcessFormat';
import { parsePreview } from './workProcessContentText';
import { normalizeAskUserAnswers } from '@shared/utils/askUser';
import { getMeaningfulBlockSummary } from './workProcessBlockText';

export const createPlanReviewRow = (call: ConversationToolCall): WorkProcessRow => ({
  type: 'planReview',
  id: call.id,
  status: call.status === 'error' ? 'error' : call.planReview?.status === 'approved' ? 'complete' : 'running',
  plan: call.planReview!,
  duration: formatDurationMs(call.startedAt, call.completedAt),
});

export const createPlanReviewShellRow = (call: ConversationToolCall): WorkProcessRow => {
  const rejected = call.planReview?.status === 'rejected';
  const feedback = call.planReview?.decision?.kind === 'reject' ? call.planReview.decision.feedback : call.resultPreview;
  return {
    type: 'tool',
    id: call.id,
    status: rejected || call.status === 'error' ? 'complete' : 'complete',
    verb: rejected ? '已更新计划 · 已拒绝' : '已更新计划',
    category: '计划产物',
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

export const createUserInputRow = (call: ConversationToolCall): WorkProcessRow => {
  const questions = call.userInputQuestions ?? [];
  const incomplete = questions.length === 0;
  const status = incomplete
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
    verb: incomplete ? '问题数据不完整' : status === 'complete' ? '已询问' : status === 'error' ? '询问已中断' : '正在询问',
    questionCount: questions.length,
    items,
    answeredCount: items.filter((item) => Boolean(item.answer)).length,
    incomplete,
    error: incomplete ? undefined : call.error || undefined,
    duration: formatDurationMs(call.startedAt, call.completedAt),
  };
};

export const createApprovalRow = (block: ConversationWorkBlock): WorkProcessRow => {
  const resolvedText = (getMeaningfulBlockSummary(block) || '').trim();
  const isGenericDecision = /^(approved once|user denied)$/i.test(resolvedText);
  const message = isGenericDecision ? '' : compactText(resolvedText, 300);
  const isAutoReview = block.id.includes('auto-review');

  return {
    type: 'approval',
    id: block.id,
    status: block.status,
    verb: getApprovalVerb(block.status, isAutoReview),
    message,
    duration: formatDurationMs(block.startedAt, block.completedAt),
    detailLines: [],
    metaLines: [],
  };
};

const getApprovalVerb = (status: WorkProcessRowStatus, isAutoReview: boolean): string => {
  if (status === 'error') return isAutoReview ? '自动检查拒绝' : '已拒绝';
  if (status === 'running' || status === 'pending') return isAutoReview ? '自动检查中' : '等待审批';
  return isAutoReview ? '自动检查通过' : '已批准';
};
