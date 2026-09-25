import { type ConversationToolCall, type ConversationToolApproval, type ConversationToolApprovalStatus } from '@shared/types/conversation';
import { type WorkProcessRow, type WorkProcessToolApproval, type WorkProcessRowStatus } from './workProcessTypes';
import { normalizeToolName, getToolDisplay, getToolFamily, formatMcpTarget } from './workProcessToolCatalog';
import { createUserInputRow, createPlanReviewShellRow, createPlanReviewRow } from './workProcessDecisionRows';
import { parsePreview, createDetailLines, prettyPrint, toRecord, readNestedString, isJsonLike, readNestedValue, stringifyPreview, isRawPayloadPreview } from './workProcessContentText';
import { emptyUnwrappedContent, unwrapToolContentLayer, sanitizeContentText } from './workProcessToolContent';
import { extractWebToolPresentation } from './workProcessWebPresentation';
import { formatDurationMs, normalizeWorkProcessText, compactText } from './workProcessFormat';

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

export const createToolRowForPresentation = (call: ConversationToolCall): WorkProcessRow => {
  if (normalizeToolName(call.toolName) === 'ask_user') {
    return createUserInputRow(call);
  }
  if (normalizeToolName(call.toolName) === 'plan_artifact' && call.planReview) {
    if (call.planReview.status === 'superseded' || call.planReview.status === 'rejected') {
      return createPlanReviewShellRow(call);
    }
    return createPlanReviewRow(call);
  }
  const display = getToolDisplay(call.toolName);
  const approval = createToolApprovalPresentation(call.approval, call.toolName);
  const rawResult = call.error || call.resultPreview;
  const parsedResult = parsePreview(rawResult);
  const suppressApprovalPreview = Boolean(approval) && isApprovalRequiredPreview(parsedResult, rawResult);
  const status = deriveToolStatus(call, parsedResult);
  const unwrapped = suppressApprovalPreview
    ? emptyUnwrappedContent()
    : unwrapToolContentLayer(call.toolName, parsedResult, call.error ? undefined : call.resultPreview, call.argsPreview);
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
    verb: getToolVerb(call.toolName, status, call.error || call.resultPreview, call.approval),
    category: display.category,
    icon: display.icon,
    groupKind: display.groupKind,
    family: getToolFamily(call.toolName),
    toolName: call.toolName,
    target: getToolTarget(call.toolName, call.argsPreview),
    duration: formatDurationMs(call.startedAt, call.completedAt),
    argsLines: createDetailLines(prettyPrint(call.argsPreview), 10),
    previewLines,
    rawLines: suppressApprovalPreview ? [] : createDetailLines(prettyPrint(call.error || call.resultPreview), 40),
    bodyText: unwrapped.bodyText,
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
  toolName: string,
): WorkProcessToolApproval | undefined => {
  if (!approval) return undefined;
  const isAutoReview = approval.reviewer === 'auto_review' || approval.approvalId.startsWith('auto-review-');
  const reason = normalizeApprovalMessage(approval.reason, toolName);
  const answer = normalizeApprovalMessage(approval.answer, toolName);
  const messageSource = approval.status === 'approved'
    ? (isGenericDecisionText(answer) ? '' : answer)
    : (isGenericDecisionText(answer) ? reason : answer) || reason;
  const message = compactText(messageSource || fallbackApprovalMessage(approval.status), 300);
  const metaLines = [
    approval.risk ? `风险：${approval.risk}` : '',
    isAutoReview ? '自动检查' : '人工审批',
  ].filter(Boolean);

  return {
    status: approval.status,
    verb: getToolApprovalVerb(approval.status, isAutoReview),
    message,
    metaLines,
  };
};

const getToolApprovalVerb = (status: ConversationToolApprovalStatus, isAutoReview: boolean): string => {
  if (status === 'pending') return isAutoReview ? '自动检查中' : '等待审批';
  if (status === 'approved') return isAutoReview ? '自动检查通过' : '已批准';
  if (status === 'rejected') return isAutoReview ? '自动检查拒绝' : '已拒绝';
  return '已取消';
};

const fallbackApprovalMessage = (status: ConversationToolApprovalStatus): string => {
  if (status === 'pending') return '当前权限模式要求先审批这个动作。';
  if (status === 'approved') return '这个动作已经批准继续执行。';
  if (status === 'rejected') return '这个动作已被拒绝。';
  return '这个动作已取消。';
};

const normalizeApprovalMessage = (value: string | undefined, toolName: string): string => {
  const text = value?.trim() ?? '';
  if (!text) return '';
  const networkMatch = text.match(/^Network tool "([^"]+)" requires approval in the current permission mode.?$/i);
  if (networkMatch) return `当前权限模式要求先审批 ${networkMatch[1]}。`;
  const toolMatch = text.match(/^Tool "([^"]+)" requires approval(?: before it can run)?.?$/i);
  if (toolMatch) return `当前权限模式要求先审批 ${toolMatch[1]}。`;
  if (/requires approval/i.test(text)) return `当前权限模式要求先审批 ${toolName}。`;
  return text;
};

const isGenericDecisionText = (value: string): boolean => (
  /^(approved once|user denied)$/i.test(value.trim())
);

const isToolApprovalRejected = (approval: ConversationToolApproval | undefined): boolean => (
  approval?.status === 'rejected' || approval?.status === 'cancelled'
);

const isApprovalRequiredPreview = (parsedResult: unknown, raw?: string): boolean => {
  const record = toRecord(parsedResult);
  const errorMessage = record
    ? readNestedString(record, ['error', 'message']) || readNestedString(record, ['message'])
    : '';
  return /approval required|requires approval/i.test(`${errorMessage} ${raw ?? ''}`);
};

const deriveToolStatus = (call: ConversationToolCall, parsedResult: unknown): WorkProcessRowStatus => {
  if (call.approval?.status === 'pending') return 'running';
  if (isToolApprovalRejected(call.approval)) return 'error';
  if (call.status === 'error' || call.error) return 'error';
  if (call.status !== 'complete') return call.status;
  if (resultIndicatesFailure(parsedResult, call.resultPreview)) return 'error';
  return call.status;
};

export const getToolVerb = (
  toolName: string,
  status: WorkProcessRowStatus,
  resultPreview?: string,
  approval?: ConversationToolApproval,
): string => {
  const display = getToolDisplay(toolName);
  if (approval?.status === 'pending') return '等待审批';
  if (status === 'pending') return display.pendingVerb ?? '等待执行';
  if (status === 'running') return display.runningVerb;
  if (status === 'skipped') return '已跳过';
  if (status !== 'error') return display.completeVerb;
  return isToolApprovalRejected(approval) || /approval required|no changes were made/i.test(resultPreview ?? '') ? '已阻断' : '执行失败';
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
