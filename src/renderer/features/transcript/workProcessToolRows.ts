import { type ConversationToolCall, type ConversationToolApproval, type ConversationToolApprovalStatus } from '@shared/types/conversation';
import { isAutomaticToolApproval } from '@shared/utils/toolApproval';
import { formatToolApprovalReason } from '../../lib/toolApprovalText';
import { type WorkProcessRow, type WorkProcessToolApproval, type WorkProcessRowStatus } from './workProcessTypes';
import { normalizeToolName, getToolDisplay, getToolFamily, toolDisplayName, formatMcpTarget } from './workProcessToolCatalog';
import { createUserInputRow, createPlanReviewShellRow, createPlanReviewRow } from './workProcessDecisionRows';
import { parsePreview, createDetailLines, prettyPrint, toRecord, readNestedString, isJsonLike, readNestedValue, stringifyPreview, isRawPayloadPreview, isInternalAddress } from './workProcessContentText';
import { unwrapToolContentLayer } from './workProcessToolContent';
import { emptyUnwrappedContent } from './workProcessToolContentShared';
import { extractWebToolPresentation } from './workProcessWebPresentation';
import { formatDurationMs, normalizeWorkProcessText, compactText } from './workProcessFormat';
import { getToolOutcome } from './workProcessOutcome';
import type { Translator } from '../../i18n/messages';

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
  // Working shows the current revision as the plan card; revisions it replaced fold into one compact row.
  if (normalizeToolName(call.toolName) === 'plan_artifact' && call.planReview) {
    const replaced = ['superseded', 'rejected', 'cancelled'].includes(call.planReview.status);
    return replaced ? createPlanReviewShellRow(call, t) : createPlanReviewRow(call);
  }
  const display = getToolDisplay(call.toolName);
  const approval = createToolApprovalPresentation(call.approval, t);
  const rawResult = call.error || call.resultPreview;
  const parsedResult = parsePreview(rawResult);
  const suppressApprovalPreview = Boolean(approval) && isApprovalRequiredPreview(parsedResult, rawResult);
  const status = deriveToolStatus(call, parsedResult);
  // A failure's own text is the caption below the header and the raw receipt; it is not content to lay out again.
  const unwrapped = suppressApprovalPreview || call.error
    ? emptyUnwrappedContent()
    : unwrapToolContentLayer(call.toolName, parsedResult, call.resultPreview, call.argsPreview, t);
  const previewLines = unwrapped.previewLines;
  const webPresentation = extractWebToolPresentation(call.toolName, parsedResult, call.argsPreview, status);
  // A failed read or search already says so in its title and on its pill; the HTTP reason stays in the raw receipt.
  const diagnosticCaption = status === 'error' && !webPresentation.webPages && !webPresentation.webQuery
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
    verb: getToolVerb(call.toolName, status, call.approval, t),
    category: t(display.category),
    icon: display.icon,
    groupKind: display.groupKind,
    family: getToolFamily(call.toolName),
    toolName: call.toolName,
    target: (normalizeToolName(call.toolName) === 'artifact_read' ? artifactObject(call.argsPreview, t) : '') || getToolTarget(call.toolName, call.argsPreview),
    duration: formatDurationMs(call.executionStartedAt, call.completedAt),
    startedAt: call.executionStartedAt,
    completedAt: call.completedAt,
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
  return compactText(withoutMachinePrefix(firstLine), 160);
};

/**
 * Runtime failures are written for the model: an error code, the tool in brackets and a field path lead the reason.
 * The surface keeps only the reason; the full text stays in the raw receipt.
 */
const MACHINE_PREFIX = /^(?:[A-Z][A-Z0-9_]{2,}:|\[[^\]\n]+\]|[A-Za-z_][\w-]*(?:\.[\w-]+|\[\d+\])+:)\s*/u;
const withoutMachinePrefix = (line: string): string => {
  let rest = line;
  for (let previous = ''; previous !== rest;) {
    previous = rest;
    rest = rest.replace(MACHINE_PREFIX, '');
  }
  return rest.trim() || line;
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
  approval: ConversationToolApproval | undefined,
  t: Translator,
): string => {
  const display = getToolDisplay(toolName);
  if (approval?.status === 'pending') return getToolApprovalVerb(approval, isAutomaticToolApproval(approval), t);
  if (status === 'pending') return display.pendingVerb ? t(display.pendingVerb) : t('chat.workProcessToolPending');
  if (status === 'running') return t(display.runningVerb);
  if (status === 'skipped') return t('chat.workProcessStatusSkipped');
  if (status === 'cancelled') return t('chat.workProcessApprovalCancelled');
  return status === 'error' ? toolDisplayName(toolName, t) : t(display.completeVerb);
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

const ARTIFACT_KINDS = ['tool-outputs', 'plans', 'investigation', 'outputs'] as const;

/** A stored artifact is named by the kind of record it is; its address and hash stay in the raw receipt. */
const artifactObject = (argsPreview: string | undefined, t: Translator): string => {
  const kind = /session:\/\/([a-z-]+)\//u.exec(argsPreview ?? '')?.[1];
  const known = ARTIFACT_KINDS.find((candidate) => candidate === kind);
  return known ? t(`chat.artifactObject.${known}`) : '';
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
    if (text) return isInternalAddress(text) ? '' : compactText(text, 180);
  }

  const fallback = Object.entries(record)
    .filter(([key]) => !RAW_PAYLOAD_TARGET_KEYS.has(key))
    .map(([, value]) => stringifyPreview(value))
    .find((text) => text.length > 0 && text.length < 160);
  return fallback ? compactText(fallback, 180) : '';
};
