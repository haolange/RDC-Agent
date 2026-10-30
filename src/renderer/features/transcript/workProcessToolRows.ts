import { formatToolApprovalReason } from '../../lib/toolApprovalText';
import type { Translator } from '../../i18n/messages';
import { type ConversationToolCall, type ConversationToolApproval, type ConversationToolApprovalStatus } from '@shared/types/conversation';
import { type WorkProcessRow, type WorkProcessToolApproval, type WorkProcessRowStatus } from './workProcessTypes';
import { normalizeToolName, getToolDisplay, getToolFamily, formatMcpTarget } from './workProcessToolCatalog';
import { createUserInputRow, createPlanReviewShellRow, createPlanReviewRow } from './workProcessDecisionRows';
import { parsePreview, createDetailLines, prettyPrint, toRecord, readNestedString, isJsonLike, readNestedValue, stringifyPreview, isRawPayloadPreview } from './workProcessContentText';
import { emptyUnwrappedContent, unwrapToolContentLayer, sanitizeContentText } from './workProcessToolContent';
import { extractWebToolPresentation } from './workProcessWebPresentation';
import { formatDurationMs, normalizeWorkProcessText, compactText } from './workProcessFormat';
import { getToolOutcome } from './workProcessOutcome';
import { isAutomaticToolApproval } from '@shared/utils/toolApproval';

const TARGET_KEYS = [
  'uri',
  'ref',
  'path',
  'title',
  'file',
  'filePath',
  'filepath',
  'target',
  'pattern',
  'query',
  'code',
  'key',
  'skill_id',
  'skillId',
  'url',
  'spaceId',
  'cardId',
  'relativePath',
  'command',
  'cmd',
  'cwd',
  'glob',
  'include',
  'input',
  'subject',
  'taskId',
  'name',
  'agent',
  'source',
  'destination',
  'dest',
  'from',
  'to',
];

const RAW_PAYLOAD_TARGET_KEYS = new Set(['content', 'text', 'body', 'payload']);

export const createToolRowForPresentation = (call: ConversationToolCall, t: Translator): WorkProcessRow => {
  if (normalizeToolName(call.toolName) === 'ask_user') {
    return createUserInputRow(call, t);
  }
  if (normalizeToolName(call.toolName) === 'plan_artifact' && call.planReview) {
    if (call.planReview.status === 'superseded' || call.planReview.status === 'rejected' || call.planReview.status === 'cancelled') {
      return createPlanReviewShellRow(call, t);
    }
    return createPlanReviewRow(call);
  }
  const display = getToolDisplay(call.toolName);
  const approval = createToolApprovalPresentation(call.approval, t);
  const rawResult = call.error || call.resultPreview;
  const parsedResult = parsePreview(rawResult);
  const suppressApprovalPreview = Boolean(approval) && isApprovalRequiredPreview(parsedResult, rawResult);
  const status = deriveToolStatus(call, parsedResult);
  const unwrapped = suppressApprovalPreview
    ? emptyUnwrappedContent()
    : unwrapToolContentLayer(call.toolName, parsedResult, call.error ? undefined : call.resultPreview, call.argsPreview, t);
  const previewLines = call.error && !suppressApprovalPreview
    ? (
      unwrapped.previewLines.length > 0
        ? unwrapped.previewLines
        : createDetailLines(sanitizeContentText(call.error), 4)
    )
    : unwrapped.previewLines;
  const webPresentation = extractWebToolPresentation(call.toolName, parsedResult);
  const diagnosticCaption = status === 'error'
    ? (extractDiagnosticCaption(
      parsePreview(call.resultPreview) ?? parsedResult,
      call.error || call.resultPreview,
      previewLines,
    ) || undefined)
    : undefined;

  return {
    type: 'tool',
    id: call.id,
    status,
    verb: getToolVerb(call.toolName, status, call.error || call.resultPreview, call.approval, t),
    category: t(display.category),
    icon: display.icon,
    groupKind: display.groupKind,
    family: getToolFamily(call.toolName),
    toolName: call.toolName,
    target: getToolTarget(call.toolName, call.argsPreview),
    duration: formatDurationMs(call.executionStartedAt, call.completedAt),
    argsLines: createDetailLines(prettyPrint(call.argsPreview), 10),
    previewLines,
    rawLines: suppressApprovalPreview ? [] : createDetailLines(prettyPrint(call.error || call.resultPreview), 40),
    bodyText: unwrapped.bodyText,
    outcome: status === 'complete' ? getToolOutcome(normalizeToolName(call.toolName), parsedResult, call.argsPreview) : undefined,
    bodyLines: unwrapped.bodyLines,
    previewKind: unwrapped.previewKind,
    commandText: unwrapped.commandText,
    pathChip: unwrapped.pathChip,
    chips: unwrapped.chips,
    diagnosticCaption,
    hookDiagnostics: call.hookDiagnostics,
    approval,
    imagePreviews: call.imagePreviews,
    ...webPresentation,
  };
};

/** Prefer a short human-readable failure line over the full tool JSON envelope. */
export const extractDiagnosticCaption = (
  parsedResult: unknown,
  raw?: string,
  previewLines: string[] = [],
): string => {
  const record = toRecord(parsedResult);
  const fromNested = record
    ? (
      readNestedString(record, ['error', 'message'])
      || readNestedString(record, ['message'])
      || readNestedString(record, ['data', 'error', 'message'])
    )
    : '';
  const candidates = [
    fromNested,
    ...previewLines,
    typeof parsedResult === 'string' ? parsedResult : '',
    raw ?? '',
  ]
    .map((value) => normalizeWorkProcessText(value).replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .filter((value) => !isJsonLike(value) && !/^\{?\s*"?ok"?\s*:/i.test(value));

  const caption = candidates[0] ?? '';
  if (!caption) return '';
  const firstLine = caption.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? caption;
  return compactText(firstLine, 160);
};

const createToolApprovalPresentation = (
  approval: ConversationToolApproval | undefined,
  t: Translator,
): WorkProcessToolApproval | undefined => {
  if (!approval) return undefined;
  const isAutoReview = isAutomaticToolApproval(approval);
  const reason = formatToolApprovalReason(approval.reason, t);
  const answer = formatToolApprovalReason(approval.answer, t);
  const messageSource = approval.status === 'approved'
    ? (isGenericDecisionText(answer) ? '' : answer)
    : (isGenericDecisionText(answer) ? reason : answer) || reason;
  const message = approval.status === 'cancelled' && approval.errorCode === 'PERMISSION_MODE_CHANGED'
    ? t('chat.workProcessApprovalModeChangedMessage')
    : compactText(messageSource || fallbackApprovalMessage(approval.status, t), 300);
  const riskKey = approval.risk === 'low' ? 'chat.workProcessRiskLow' : approval.risk === 'medium' ? 'chat.workProcessRiskMedium' : approval.risk === 'high' ? 'chat.workProcessRiskHigh' : undefined;
  const metaLines = [
    approval.risk ? (riskKey ? t(riskKey) : t('chat.approvalRisk', { risk: approval.risk })) : '',
    isAutoReview ? approval.reviewMethod === 'rule' ? t('chat.workProcessRuleReview') : approval.reviewMethod === 'model' ? t('chat.workProcessModelReview') : t('chat.workProcessAutoReviewMeta') : t('chat.workProcessManualReviewMeta'),
    approval.status === 'rejected' ? t('chat.workProcessNotExecuted') : '',
  ].filter(Boolean);

  return {
    status: approval.status,
    verb: getToolApprovalVerb(approval, isAutoReview, t),
    message,
    metaLines,
  };
};

const getToolApprovalVerb = (approval: ConversationToolApproval, isAutoReview: boolean, t: Translator): string => {
  const { status, reviewMethod, errorCode } = approval;
  if (status === 'cancelled') return t(errorCode === 'PERMISSION_MODE_CHANGED'
    ? 'chat.workProcessApprovalModeChanged' : 'chat.workProcessApprovalCancelled');
  if (status === 'rejected' && errorCode) return t('chat.workProcessReviewIncomplete');
  if (isAutoReview && reviewMethod === 'rule') return status === 'pending' ? t('chat.workProcessRulePending') : status === 'approved' ? t('chat.workProcessRuleApproved') : t('chat.workProcessRuleRejected');
  if (isAutoReview && reviewMethod === 'model') return status === 'pending' ? t('chat.workProcessModelPending') : status === 'approved' ? t('chat.workProcessModelApproved') : t('chat.workProcessModelRejected');
  if (status === 'pending') return isAutoReview ? t('chat.workProcessAutoReviewPending') : t('chat.workProcessApprovalPending');
  if (status === 'approved') return isAutoReview ? t('chat.workProcessAutoReviewApproved') : t('chat.workProcessApprovalApproved');
  return isAutoReview ? t('chat.workProcessAutoReviewRejected') : t('chat.workProcessApprovalRejected');
};

const fallbackApprovalMessage = (status: ConversationToolApprovalStatus, t: Translator): string => {
  if (status === 'pending') return t('chat.approvalRequiredMessage');
  if (status === 'approved') return t('chat.approvalApprovedMessage');
  if (status === 'rejected') return t('chat.approvalRejectedMessage');
  return t('chat.approvalCancelledMessage');
};

const isGenericDecisionText = (value: string): boolean => (
  /^(approved once|user denied)$/i.test(value.trim())
);

const isToolApprovalRejected = (approval: ConversationToolApproval | undefined): boolean => (
  approval?.status === 'rejected'
);

const isApprovalRequiredPreview = (parsedResult: unknown, raw?: string): boolean => {
  const record = toRecord(parsedResult);
  const errorMessage = record
    ? readNestedString(record, ['error', 'message']) || readNestedString(record, ['message'])
    : '';
  return /approval required|requires approval/i.test(`${errorMessage} ${raw ?? ''}`);
};

const deriveToolStatus = (call: ConversationToolCall, parsedResult: unknown): WorkProcessRowStatus => {
  if (call.status !== 'complete' && call.status !== 'error') {
    if (call.status === 'cancelled' || (call.approval?.status === 'cancelled' && call.approval.errorCode !== 'PERMISSION_MODE_CHANGED')) return 'cancelled';
    if (call.approval?.status === 'pending') return 'running';
    if (isToolApprovalRejected(call.approval)) return 'error';
  }
  if (call.status === 'error' || call.error) return 'error';
  if (call.status !== 'complete') return call.status;
  if (resultIndicatesFailure(parsedResult, call.resultPreview)) return 'error';
  return call.status;
};

export const getToolVerb = (
  toolName: string,
  status: WorkProcessRowStatus,
  resultPreview: string | undefined,
  approval: ConversationToolApproval | undefined,
  t: Translator,
): string => {
  const display = getToolDisplay(toolName);
  if (approval?.status === 'pending') return getToolApprovalVerb(approval, isAutomaticToolApproval(approval), t);
  if (status === 'pending') return display.pendingVerb ? t(display.pendingVerb) : t('chat.workProcessToolPending');
  if (status === 'running') return t(display.runningVerb);
  if (status === 'skipped') return t('chat.workProcessStatusSkipped');
  if (status === 'cancelled') return t('chat.workProcessApprovalCancelled');
  if (status !== 'error') return t(display.completeVerb);
  return isToolApprovalRejected(approval) || /approval required|no changes were made/i.test(resultPreview ?? '') ? t('chat.workProcessToolBlocked') : t('chat.workProcessToolFailed');
};

const resultIndicatesFailure = (parsedResult: unknown, raw?: string): boolean => {
  const record = toRecord(parsedResult);
  if (record) {
    if (record.ok === false) return true;
    const status = String(record.status ?? readNestedValue(record, ['data', 'status']) ?? '').toLowerCase();
    if (status === 'error' || status === 'failed') return true;
    const errorMessage = readNestedString(record, ['error', 'message']) || readNestedString(record, ['message']);
    if (/approval required|no changes were made/i.test(errorMessage)) return true;
  }
  return /approval required|no changes were made/i.test(raw ?? '');
};

const getToolTarget = (toolName: string, argsPreview?: string): string => {
  const mcpTarget = formatMcpTarget(toolName);
  const parsed = parsePreview(argsPreview);
  const record = toRecord(parsed);
  if (!record) {
    const text = stringifyPreview(parsed);
    if (mcpTarget) return mcpTarget;
    return isRawPayloadPreview(text) ? '' : compactText(text, 180);
  }

  const source = stringifyPreview(record.source ?? record.from);
  const destination = stringifyPreview(record.destination ?? record.dest ?? record.to);
  if (source && destination) return compactText(`${source} -> ${destination}`, 180);
  if (mcpTarget) return mcpTarget;

  for (const key of TARGET_KEYS) {
    const text = stringifyPreview(record[key]);
    if (text) return compactText(text, 180);
  }

  const fallback = Object.entries(record)
    .filter(([key]) => !RAW_PAYLOAD_TARGET_KEYS.has(key))
    .map(([, value]) => stringifyPreview(value))
    .find((text) => text.length > 0 && text.length < 160);
  return fallback ? compactText(fallback, 180) : '';
};
