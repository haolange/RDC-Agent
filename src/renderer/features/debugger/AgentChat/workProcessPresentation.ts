import type {
  ConversationToolApproval,
  ConversationToolApprovalStatus,
  ConversationToolCall,
  ConversationWorkBlock,
  ConversationWorkTrace,
} from '@shared/types/conversation';
import type { ThinkingArtifact } from '@shared/types/reasoning';

export type WorkProcessRowStatus = 'pending' | 'running' | 'complete' | 'error';


export interface WorkProcessToolApproval {
  status: ConversationToolApprovalStatus;
  verb: string;
  message: string;
  metaLines: string[];
}

export type WorkProcessRow =
  | {
    type: 'summary';
    id: string;
    status: WorkProcessRowStatus;
    text: string;
    detailLines: string[];
    duration: string;
  }
  | {
    type: 'tool';
    id: string;
    status: WorkProcessRowStatus;
    verb: string;
    category: string;
    toolName: string;
    target: string;
    duration: string;
    argsLines: string[];
    previewLines: string[];
    rawLines: string[];
    approval?: WorkProcessToolApproval;
    compact?: boolean;
  }
  | {
    type: 'userInput';
    id: string;
    status: WorkProcessRowStatus;
    verb: string;
    question: string;
    answer?: string;
    duration: string;
    detailLines: string[];
  }
  | {
    type: 'approval';
    id: string;
    status: WorkProcessRowStatus;
    verb: string;
    message: string;
    duration: string;
    detailLines: string[];
    metaLines: string[];
  }
  | {
    type: 'diagnostic';
    id: string;
    status: WorkProcessRowStatus;
    message: string;
    detailLines: string[];
    duration: string;
  }
  | {
    type: 'subagent';
    id: string;
    status: WorkProcessRowStatus;
    profile: string;
    summary: string;
    detail: string;
    duration: string;
    children: WorkProcessRow[];
  }
  | {
    type: 'task';
    id: string;
    status: WorkProcessRowStatus;
    title: string;
    taskStatus: string;
    duration: string;
  }
  | {
    type: 'section';
    id: string;
    status: WorkProcessRowStatus;
    resultText: string;
    resultToolSummary: string;
    resultStreaming: boolean;
    clampResult: boolean;
    thinkingPreview: string;
    thinkingLabel: string;
    thinkingKind?: ThinkingArtifact['kind'];
    thinkingSource?: ThinkingArtifact['source'];
    thinkingVisibility?: ThinkingArtifact['visibility'];
    thinkingStatus?: ConversationWorkBlock['thinkingStatus'];
    thinkingExpandable: boolean;
    thinkingOpenByDefault: boolean;
    stepCount: number;
    duration: string;
    defaultOpen: boolean;
    steps: WorkProcessRow[];
  };

export interface WorkProcessPresentation {
  rows: WorkProcessRow[];
  stepCount: number;
  toolCount: number;
  summary: string;
  duration: string;
  defaultExpanded: boolean;
  important: boolean;
}

const ROW_STATUS_LABEL: Record<WorkProcessRowStatus, string> = {
  pending: 'Waiting',
  running: 'Running',
  complete: '',
  error: 'Failed',
};

const TOOL_CATEGORY_LABELS: Array<[RegExp, string]> = [
  [/read_file|read|open|get|load/i, 'Read'],
  [/glob|grep|search_codebase|find|list|ls/i, 'Search'],
  [/write_file|write|save/i, 'Write'],
  [/edit_file|edit|patch|notebook_edit/i, 'Edit'],
  [/delete_file|move_file|copy_file/i, 'File'],
  [/artifact|plan_artifact/i, 'Artifact'],
  [/bash|shell|exec|command|run/i, 'Command'],
  [/web_fetch|web_search|web|fetch|browser|http/i, 'Web'],
  [/git_/i, 'Git'],
  [/memory_/i, 'Memory'],
  [/task_/i, 'Task'],
  [/skills|mcp|rdx_context/i, 'Runtime'],
  [/approval|ask/i, 'Question'],
  [/agent_handoff|handoff|agent|task/i, 'Collaboration'],
];

const TOOL_VERB_LABELS: Array<[RegExp, string]> = [
  [/git_status/i, 'Checked status'],
  [/git_diff/i, 'Compared changes'],
  [/git_log/i, 'Checked history'],
  [/git_add/i, 'Staged changes'],
  [/git_unstage/i, 'Unstaged changes'],
  [/git_commit/i, 'Created commit'],
  [/grep|search_codebase/i, 'Searched code'],
  [/glob|list|ls/i, 'Listed files'],
  [/read_file|read|open|get|load/i, 'Read file'],
  [/write_file|write|save/i, 'Wrote file'],
  [/plan_artifact|artifact/i, 'Wrote artifact'],
  [/edit_file|edit|patch/i, 'Edited file'],
  [/notebook_edit/i, 'Edited notebook'],
  [/delete_file/i, 'Deleted file'],
  [/move_file/i, 'Moved file'],
  [/copy_file/i, 'Copied file'],
  [/bash|shell|exec|command|run/i, 'Ran command'],
  [/web_fetch/i, 'Fetched page'],
  [/web_search/i, 'Searched web'],
  [/web|fetch|browser|http/i, 'Fetched web'],
  [/memory_read/i, 'Read memory'],
  [/memory_write/i, 'Wrote memory'],
  [/memory_delete/i, 'Deleted memory'],
  [/task_list/i, 'Listed tasks'],
  [/task_create/i, 'Created task'],
  [/task_update/i, 'Updated task'],
  [/task_get/i, 'Read task'],
  [/skills/i, 'Listed skills'],
  [/mcp/i, 'Queried MCP'],
  [/rdx_context/i, 'Read context'],
  [/agent_handoff|handoff/i, 'Prepared handoff'],
  [/approval|ask/i, 'Asked user'],
  [/agent|task/i, 'Delegated work'],
];

const TOOL_RUNNING_VERB_LABELS: Array<[RegExp, string]> = [
  [/git_status/i, 'Checking status'],
  [/git_diff/i, 'Comparing changes'],
  [/git_log/i, 'Checking history'],
  [/grep|search_codebase/i, 'Searching code'],
  [/glob|list|ls/i, 'Listing files'],
  [/read_file|read|open|get|load/i, 'Reading file'],
  [/write_file|write|save|plan_artifact|artifact/i, 'Writing file'],
  [/edit_file|edit|patch|notebook_edit/i, 'Editing file'],
  [/delete_file/i, 'Deleting file'],
  [/move_file/i, 'Moving file'],
  [/copy_file/i, 'Copying file'],
  [/bash|shell|exec|command|run/i, 'Running command'],
  [/web_fetch/i, 'Fetching page'],
  [/web_search/i, 'Searching web'],
  [/web|fetch|browser|http/i, 'Accessing web'],
  [/memory_read/i, 'Reading memory'],
  [/memory_write/i, 'Writing memory'],
  [/memory_delete/i, 'Deleting memory'],
  [/task_list/i, 'Listing tasks'],
  [/task_create/i, 'Creating task'],
  [/task_update/i, 'Updating task'],
  [/task_get/i, 'Reading task'],
  [/skills/i, 'Listing skills'],
  [/mcp/i, 'Querying MCP'],
  [/rdx_context/i, 'Reading context'],
  [/agent_handoff|handoff/i, 'Preparing handoff'],
  [/agent|task/i, 'Delegating work'],
];

const TARGET_KEYS = [
  'path',
  'title',
  'file',
  'filePath',
  'filepath',
  'target',
  'pattern',
  'query',
  'url',
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
const INTERNAL_BLOCK_IDS = new Set(['runtime-run', 'assistant-output', 'runtime-reasoning']);

const resolveSectionResult = (
  block: ConversationWorkBlock,
): { resultText: string; resultToolSummary: string; resultStreaming: boolean; clampResult: boolean } => {
  const resultText = normalizeWorkProcessText(block.result?.text ?? '');
  const resultStatus = block.result?.status ?? (block.status === 'running' || block.status === 'pending' ? 'streaming' : 'complete');
  return {
    resultText: isMeaningfulText(resultText) ? resultText : '',
    resultToolSummary: formatToolRequestSummary(block),
    resultStreaming: resultStatus === 'streaming',
    clampResult: true,
  };
};

const formatToolRequestSummary = (block: ConversationWorkBlock): string => {
  const ids = new Set(block.result?.toolCallIds ?? []);
  const calls = ids.size > 0
    ? block.toolCalls.filter((call) => ids.has(call.id))
    : block.toolCalls;
  if (calls.length === 0) return '';
  const names = calls.map((call) => call.toolName).filter(Boolean);
  const uniqueNames = Array.from(new Set(names));
  const namePreview = uniqueNames.slice(0, 3).join(', ');
  const suffix = uniqueNames.length > 3 ? ` +${uniqueNames.length - 3}` : '';
  const count = calls.length;
  return `Requested ${count} tool${count === 1 ? '' : 's'}${namePreview ? `: ${namePreview}${suffix}` : ''}.`;
};
const resolveSectionThinking = (
  thinking: ThinkingArtifact | undefined,
  thinkingStatus: ConversationWorkBlock['thinkingStatus'] | undefined,
): {
  preview: string;
  label: string;
  kind?: ThinkingArtifact['kind'];
  source?: ThinkingArtifact['source'];
  visibility?: ThinkingArtifact['visibility'];
  status?: ConversationWorkBlock['thinkingStatus'];
  expandable: boolean;
  openByDefault: boolean;
} => {
  if (!thinking) {
    return { preview: '', label: '', expandable: false, openByDefault: false };
  }

  const status = thinkingStatus ?? 'complete';
  if (thinking.kind === 'opaque' || thinking.visibility === 'hidden') {
    return {
      preview: '',
      label: 'Provider continuation state retained',
      kind: thinking.kind,
      source: thinking.source,
      visibility: thinking.visibility,
      status,
      expandable: false,
      openByDefault: false,
    };
  }

  const preview = normalizeWorkProcessText(thinking.text ?? '');
  const isSummary = thinking.kind === 'summary' && thinking.visibility === 'summary';
  const isRaw = thinking.kind === 'raw' && thinking.visibility === 'raw-collapsed';
  const expandable = Boolean(preview) && (isSummary || isRaw);
  return {
    preview,
    label: status === 'streaming' ? 'Thinking' : 'Thought',
    kind: thinking.kind,
    source: thinking.source,
    visibility: thinking.visibility,
    status,
    expandable,
    openByDefault: isSummary && status === 'streaming',
  };
};
export const normalizeWorkProcessText = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) return '';
  return trimmed
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .trim();
};

const normalizeToolName = (toolName: string): string => toolName.trim().toLowerCase().replace(/[.\-]/g, '_');

const NOISY_TEXT_PATTERNS = [
  /agent loop/i,
  /model and tool loop/i,
  /final answer/i,
  /response complete/i,
  /assistant output ready/i,
  /start agent loop/i,
];

export const formatDurationMs = (start?: number, end?: number): string => {
  if (!start) return '';
  const finish = end ?? Date.now();
  const ms = Math.max(0, finish - start);
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.floor((ms % 60_000) / 1000);
  return `${minutes}m ${seconds.toString().padStart(2, '0')}s`;
};

export const getRowStatusLabel = (status: WorkProcessRowStatus): string => ROW_STATUS_LABEL[status];

export const buildWorkProcessPresentation = (
  trace: ConversationWorkTrace,
): WorkProcessPresentation => {
  const rows = blocksToRows(trace.blocks);
  const toolCount = countToolSteps(rows);
  const stepCount = countSteps(rows);
  const important = trace.status === 'error' || rowsHaveAttention(rows);
  const summary = isMeaningfulText(trace.summary) ? trace.summary?.trim() ?? '' : '';

  return {
    rows,
    stepCount,
    toolCount,
    summary,
    duration: formatTraceDuration(trace.blocks),
    defaultExpanded: trace.status !== 'idle' || rows.length > 0 || Boolean(summary),
    important,
  };
};

const blocksToRows = (blocks: ConversationWorkBlock[]): WorkProcessRow[] => {
  const rows: WorkProcessRow[] = [];

  for (const block of blocks) {
    if (block.kind === 'llm_turn') {
      if (block.toolCalls.length === 0 && !block.result?.text && !block.thinking) continue;
      const steps = block.toolCalls.map((call) => createToolRow(call, true));
      const sectionResult = resolveSectionResult(block);
      const sectionThinking = resolveSectionThinking(block.thinking, block.thinkingStatus);
      rows.push({
        type: 'section',
        id: block.id,
        status: block.status,
        resultText: sectionResult.resultText,
        resultToolSummary: sectionResult.resultToolSummary,
        resultStreaming: sectionResult.resultStreaming,
        clampResult: sectionResult.clampResult,
        thinkingPreview: sectionThinking.preview,
        thinkingLabel: sectionThinking.label,
        thinkingKind: sectionThinking.kind,
        thinkingSource: sectionThinking.source,
        thinkingVisibility: sectionThinking.visibility,
        thinkingStatus: sectionThinking.status,
        thinkingExpandable: sectionThinking.expandable,
        thinkingOpenByDefault: sectionThinking.openByDefault,
        stepCount: steps.length,
        duration: formatDurationMs(block.startedAt, block.completedAt),
        defaultOpen: false,
        steps,
      });
      continue;
    }

    if (block.kind === 'user_input') {
      for (const call of block.toolCalls) {
        rows.push(createToolRow(call));
      }
      continue;
    }

    if (shouldSkipBlock(block)) {
      continue;
    }

    if (block.kind === 'approval') {
      rows.push(createApprovalRow(block));
      continue;
    }

    if (block.kind === 'subagent') {
      const childRows = block.children ? blocksToRows(block.children) : [];
      rows.push({
        type: 'subagent',
        id: block.id,
        status: block.status,
        profile: block.title.replace(/^Sub-agent[:?]\s*/, '').trim() || 'sub-agent',
        summary: getMeaningfulBlockSummary(block) || block.summary || '',
        detail: block.detail ?? '',
        duration: formatDurationMs(block.startedAt, block.completedAt),
        children: childRows,
      });
      continue;
    }

    if (block.kind === 'command') {
      const summaryText = getMeaningfulBlockSummary(block);
      if (summaryText) {
        const taskStatus = block.status === 'error'
          ? 'failed'
          : block.status === 'running'
            ? 'in_progress'
            : block.status === 'pending'
              ? 'pending'
              : 'completed';
        rows.push({
          type: 'task',
          id: block.id,
          status: block.status,
          title: summaryText,
          taskStatus,
          duration: formatDurationMs(block.startedAt, block.completedAt),
        });
      }
      continue;
    }

    if (block.kind === 'diagnostic' || block.status === 'error') {
      rows.push(createDiagnosticRow(block));
      continue;
    }

    const summaryText = getMeaningfulBlockSummary(block);
    if (summaryText) {
      rows.push({
        type: 'summary',
        id: block.id,
        status: block.status,
        text: summaryText,
        detailLines: createDetailLines(block.detail, 10),
        duration: formatDurationMs(block.startedAt, block.completedAt),
      });
    }
  }

  markLastSectionOpen(rows);
  return rows;
};

const markLastSectionOpen = (rows: WorkProcessRow[]): void => {
  let lastSectionIndex = -1;
  rows.forEach((row, index) => {
    if (row.type === 'section') lastSectionIndex = index;
  });
  if (lastSectionIndex < 0) return;
  const lastSection = rows[lastSectionIndex];
  if (lastSection.type === 'section') lastSection.defaultOpen = true;
};

const countToolSteps = (rows: WorkProcessRow[]): number => rows.reduce((total, row) => {
  if (row.type === 'section') return total + countToolSteps(row.steps);
  if (row.type === 'tool' || row.type === 'userInput') return total + 1;
  return total;
}, 0);

const countSteps = (rows: WorkProcessRow[]): number => rows.reduce((total, row) => {
  if (row.type === 'section') return total + 1 + row.stepCount;
  return total + 1;
}, 0);

const rowsHaveAttention = (rows: WorkProcessRow[]): boolean => rows.some((row) => {
  if (row.type === 'section') return row.status === 'running' || row.status === 'error' || rowsHaveAttention(row.steps);
  return row.status === 'error' || row.status === 'running';
});

const formatTraceDuration = (blocks: ConversationWorkBlock[]): string => {
  const timestamps = blocks.flatMap((block) => [block.startedAt, block.completedAt].filter(isNumber));
  if (timestamps.length === 0) return '';
  return formatDurationMs(Math.min(...timestamps), blocks.some((block) => !block.completedAt) ? undefined : Math.max(...timestamps));
};

const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

const createToolRow = (call: ConversationToolCall, compact = false): WorkProcessRow => {
  if (normalizeToolName(call.toolName) === 'ask_user') {
    return createUserInputRow(call);
  }
  const approval = createToolApprovalPresentation(call.approval, call.toolName);
  const rawResult = call.error || call.resultPreview;
  const parsedResult = parsePreview(rawResult);
  const suppressApprovalPreview = Boolean(approval) && isApprovalRequiredPreview(parsedResult, rawResult);
  const status = deriveToolStatus(call, parsedResult);
  const previewLineLimit = /read_file|^read$/i.test(normalizeToolName(call.toolName)) ? 4 : 3;
  const rawPreviewLines = suppressApprovalPreview
    ? []
    : call.error
      ? createDetailLines(call.error, 4)
      : extractReadableResultLines(parsedResult, call.resultPreview, previewLineLimit);
  const previewLines = enhanceToolPreviewLines(
    call.toolName,
    parsedResult,
    suppressApprovalPreview ? undefined : call.resultPreview,
    !call.error && isLikelyBinaryText(rawPreviewLines.join('\n'))
      ? ['Binary content omitted from preview.']
      : rawPreviewLines,
  );

  return {
    type: 'tool',
    id: call.id,
    status,
    verb: getToolVerb(call.toolName, status, call.error || call.resultPreview, call.approval),
    category: matchToolLabel(call.toolName, TOOL_CATEGORY_LABELS, 'Tool'),
    toolName: call.toolName,
    target: getToolTarget(call.argsPreview),
    duration: formatDurationMs(call.startedAt, call.completedAt),
    argsLines: createDetailLines(prettyPrint(call.argsPreview), 10),
    previewLines,
    rawLines: suppressApprovalPreview ? [] : createDetailLines(prettyPrint(call.error || call.resultPreview), 16),
    approval,
    compact,
  };
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
    approval.risk ? `Risk: ${approval.risk}` : '',
    isAutoReview ? 'Auto-review' : 'Manual approval',
  ].filter(Boolean);

  return {
    status: approval.status,
    verb: getToolApprovalVerb(approval.status, isAutoReview),
    message,
    metaLines,
  };
};

const getToolApprovalVerb = (status: ConversationToolApprovalStatus, isAutoReview: boolean): string => {
  if (status === 'pending') return isAutoReview ? 'Auto-reviewing' : 'Waiting for approval';
  if (status === 'approved') return isAutoReview ? 'Auto-review passed' : 'Approved';
  if (status === 'rejected') return isAutoReview ? 'Auto-review denied' : 'Rejected';
  return 'Cancelled';
};

const fallbackApprovalMessage = (status: ConversationToolApprovalStatus): string => {
  if (status === 'pending') return 'Current permission mode requires approval before this tool can run.';
  if (status === 'approved') return 'This tool call was approved to continue.';
  if (status === 'rejected') return 'This tool call was rejected.';
  return 'This tool call was cancelled.';
};

const normalizeApprovalMessage = (value: string | undefined, toolName: string): string => {
  const text = value?.trim() ?? '';
  if (!text) return '';
  const networkMatch = text.match(/^Network tool "([^"]+)" requires approval in the current permission mode.?$/i);
  if (networkMatch) return `Current permission mode requires approval before running ${networkMatch[1]}.`;
  const toolMatch = text.match(/^Tool "([^"]+)" requires approval(?: before it can run)?.?$/i);
  if (toolMatch) return `Current permission mode requires approval before running ${toolMatch[1]}.`;
  if (/requires approval/i.test(text)) return `Current permission mode requires approval before running ${toolName}.`;
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
export const createToolRowForPresentation = (
  call: ConversationToolCall,
  compact = false,
): WorkProcessRow => createToolRow(call, compact);

const createUserInputRow = (call: ConversationToolCall): WorkProcessRow => {
  const args = parsePreview(call.argsPreview);
  const record = toRecord(args) ?? {};
  const question = stringifyPreview(record.question);
  const rawChoices = record.choices;
  const choices = Array.isArray(rawChoices)
    ? rawChoices.map(stringifyPreview).filter(Boolean)
    : [];
  const status = call.status === 'complete'
    ? 'complete'
    : call.status === 'error' || call.error
      ? 'error'
      : 'running';
  const answer = status === 'complete' && call.resultPreview?.trim()
    ? call.resultPreview.trim()
    : undefined;
  const detailLines = [
    question ? `Question: ${question}` : '',
    ...choices.map((choice, index) => `Option ${index + 1}: ${choice}`),
    answer ? `Answer: ${answer}` : '',
    call.error ? `Error: ${call.error}` : '',
  ].filter(Boolean);

  return {
    type: 'userInput',
    id: call.id,
    status,
    verb: status === 'complete' ? 'User answered' : status === 'error' ? 'User input stopped' : 'Asked user',
    question: compactText(question || 'Waiting for user input.', 280),
    answer,
    duration: formatDurationMs(call.startedAt, call.completedAt),
    detailLines,
  };
};

const createApprovalRow = (block: ConversationWorkBlock): WorkProcessRow => {
  const parsed = parsePreview(block.detail);
  const record = toRecord(parsed) ?? {};
  const detailAnswer = typeof parsed === 'string' ? parsed : stringifyPreview(record.answer);
  const reviewer = stringifyPreview(record.reviewer);
  const toolName = stringifyPreview(record.toolName);
  const risk = stringifyPreview(record.risk);
  const isAutoReview = reviewer === 'auto_review' || block.id.includes('auto-review');
  const resolvedText = (detailAnswer || getMeaningfulBlockSummary(block) || '').trim();
  const isGenericDecision = /^(approved once|user denied)$/i.test(resolvedText);
  const message = isGenericDecision ? '' : compactText(resolvedText, 300);

  return {
    type: 'approval',
    id: block.id,
    status: block.status,
    verb: getApprovalVerb(block.status, isAutoReview),
    message,
    duration: formatDurationMs(block.startedAt, block.completedAt),
    detailLines: [],
    metaLines: [
      toolName ? `Tool: ${toolName}` : '',
      risk ? `Risk: ${risk}` : '',
    ].filter(Boolean),
  };
};

const getApprovalVerb = (status: WorkProcessRowStatus, isAutoReview: boolean): string => {
  if (status === 'error') return isAutoReview ? 'Auto-review denied' : 'Rejected';
  if (status === 'running' || status === 'pending') return isAutoReview ? 'Auto-reviewing' : 'Waiting for approval';
  return isAutoReview ? 'Auto-review passed' : 'Approved';
};

const deriveToolStatus = (call: ConversationToolCall, parsedResult: unknown): WorkProcessRowStatus => {
  if (call.approval?.status === 'pending') return 'running';
  if (isToolApprovalRejected(call.approval)) return 'error';
  if (call.status === 'error' || call.error) return 'error';
  if (call.status !== 'complete') return call.status;
  if (resultIndicatesFailure(parsedResult, call.resultPreview)) return 'error';
  return call.status;
};

const getToolVerb = (
  toolName: string,
  status: WorkProcessRowStatus,
  resultPreview?: string,
  approval?: ConversationToolApproval,
): string => {
  if (approval?.status === 'pending') return 'Waiting for approval';
  if (status === 'pending') return 'Waiting to run';
  if (status === 'running') return matchToolLabel(toolName, TOOL_RUNNING_VERB_LABELS, 'Calling tool');
  if (status !== 'error') return matchToolLabel(toolName, TOOL_VERB_LABELS, 'Called tool');
  return isToolApprovalRejected(approval) || /approval required|no changes were made/i.test(resultPreview ?? '') ? 'Blocked' : 'Failed';
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

const createDiagnosticRow = (block: ConversationWorkBlock): WorkProcessRow => ({
  type: 'diagnostic',
  id: block.id,
  status: block.status === 'error' ? 'error' : block.status,
  message: getMeaningfulBlockSummary(block) || block.title || 'Runtime diagnostic',
  detailLines: createDetailLines(block.detail, 12),
  duration: formatDurationMs(block.startedAt, block.completedAt),
});

const shouldSkipBlock = (block: ConversationWorkBlock): boolean => {
  if (INTERNAL_BLOCK_IDS.has(block.id) || block.kind === 'output') return true;
  if (block.kind === 'user_input') return true;
  if (block.kind === 'approval' && block.status === 'complete') return true;
  if (!block.summary && isNoisyText(block.title)) return true;
  return false;
};

const getMeaningfulBlockSummary = (block: ConversationWorkBlock): string => {
  const candidates = [block.summary, block.title].map((value) => value?.trim()).filter(Boolean) as string[];
  return candidates.find((value) => isMeaningfulText(value)) ?? '';
};

const isMeaningfulText = (value?: string): value is string => Boolean(value?.trim()) && !isNoisyText(value);

const isNoisyText = (value?: string): boolean => {
  const text = value?.trim();
  if (!text) return true;
  return NOISY_TEXT_PATTERNS.some((pattern) => pattern.test(text));
};

const matchToolLabel = (
  toolName: string,
  labels: Array<[RegExp, string]>,
  fallback: string,
): string => labels.find(([pattern]) => pattern.test(toolName))?.[1] ?? fallback;

const getToolTarget = (argsPreview?: string): string => {
  const parsed = parsePreview(argsPreview);
  const record = toRecord(parsed);
  if (!record) {
    const text = stringifyPreview(parsed);
    return isRawPayloadPreview(text) ? '' : compactText(text, 180);
  }

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

const extractReadableResultLines = (parsed: unknown, raw?: string, maxLines = 3): string[] => {
  const collected = collectReadableText(parsed, maxLines);
  if (collected.length > 0) return collected.slice(0, maxLines);
  if (parsed && typeof parsed === 'object') {
    const rawLines = createDetailLines(raw, maxLines);
    return rawLines.length > 0 ? rawLines : [];
  }
  return createDetailLines(raw, maxLines);
};

const enhanceToolPreviewLines = (
  toolName: string,
  parsed: unknown,
  raw: string | undefined,
  previewLines: string[],
): string[] => {
  const normalized = normalizeToolName(toolName);
  const record = toRecord(parsed);

  if (normalized === 'bash' || normalized.includes('shell')) {
    const exitCode = record?.exitCode ?? record?.exit_code ?? readNestedValue(record ?? {}, ['result', 'exitCode']);
    const stdout = stringifyPreview(record?.stdout ?? readNestedValue(record ?? {}, ['result', 'stdout']));
    const lines = [
      exitCode !== undefined && exitCode !== null ? `exit ${String(exitCode)}` : '',
      ...createDetailLines(stdout || raw, 3),
    ].filter(Boolean);
    if (lines.length > 0) return lines.slice(0, 4);
  }

  if (/grep|glob|search_codebase/.test(normalized)) {
    const matches = collectReadableText(
      record?.matches ?? record?.files ?? record?.paths ?? readNestedValue(record ?? {}, ['data', 'matches']),
      4,
    );
    if (matches.length > 0) return matches;
  }

  if (/read_file|^read$/.test(normalized)) {
    const lineCount = record?.lineCount ?? record?.lines ?? readNestedValue(record ?? {}, ['meta', 'lineCount']);
    if (lineCount !== undefined) {
      return [`${String(lineCount)} lines`, ...previewLines].filter(Boolean).slice(0, 3);
    }
  }

  if (normalized.startsWith('git_')) {
    const summary = stringifyPreview(record?.summary ?? record?.status ?? record?.output ?? raw);
    const lines = createDetailLines(summary, 3);
    if (lines.length > 0) return lines;
  }

  if (/web_fetch|web_search/.test(normalized)) {
    const details = getDetailsRecord(record);
    if (details?.kind === 'search' || normalized === 'web_search') {
      const resultRecords = getRecordArray(
        details?.results
        ?? record?.results
        ?? readNestedValue(record ?? {}, ['data', 'details', 'results']),
      );
      const resultLines = resultRecords.slice(0, 3).flatMap((result, index) => {
        const title = stringifyPreview(result.title);
        const url = stringifyPreview(result.url);
        const source = stringifyPreview(result.source ?? result.domain);
        const publishedAt = stringifyPreview(result.publishedAt ?? result.date);
        return [
          title ? `${index + 1}. ${title}` : '',
          url,
          source || publishedAt ? [source ? `Source: ${source}` : '', publishedAt ? `Date: ${publishedAt}` : ''].filter(Boolean).join(' / ') : '',
        ].filter(Boolean);
      });
      const lines = [
        stringifyPreview(details?.provider) ? `Provider: ${stringifyPreview(details?.provider)}` : '',
        stringifyPreview(details?.resultCount) ? `Results: ${stringifyPreview(details?.resultCount)}` : '',
        ...resultLines,
      ].filter(Boolean);
      if (lines.length > 0) return lines.slice(0, 8);
    }

    const status = stringifyPreview(details?.status ?? record?.status ?? record?.statusCode);
    const statusText = stringifyPreview(details?.statusText ?? record?.statusText);
    const url = stringifyPreview(details?.url ?? record?.url ?? readNestedValue(record ?? {}, ['data', 'details', 'url']));
    const lines = [
      status ? `HTTP ${status}${statusText ? ` ${statusText}` : ''}` : '',
      url,
    ].filter(Boolean);
    if (lines.length > 0) return [...lines, ...previewLines].slice(0, 4);
  }

  if (normalized.startsWith('task_') || normalized.startsWith('memory_')) {
    const summary = stringifyPreview(
      record?.subject
      ?? record?.name
      ?? record?.taskId
      ?? record?.id
      ?? record?.title,
    );
    if (summary) return [summary, ...previewLines].slice(0, 3);
  }

  return previewLines;
};

const getDetailsRecord = (record: Record<string, unknown> | null | undefined): Record<string, unknown> | null => {
  if (!record) return null;
  return toRecord(record.details)
    ?? toRecord(readNestedValue(record, ['data', 'details']))
    ?? toRecord(readNestedValue(record, ['result', 'details']));
};


const getRecordArray = (value: unknown): Array<Record<string, unknown>> => {
  if (!Array.isArray(value)) return [];
  return value.map(toRecord).filter((entry): entry is Record<string, unknown> => Boolean(entry));
};

const isRawPayloadPreview = (value: string): boolean => {
  const text = value.trim();
  if (!text) return false;
  return /^\{?\s*"?(?:content|text|body|payload)"?\s*:/.test(text);
};

const collectReadableText = (value: unknown, maxLines = 6): string[] => {
  if (value === null || value === undefined) return [];
  if (typeof value === 'string') {
    const extracted = extractContentTextFromJsonishString(value);
    return createDetailLines(extracted || value, maxLines);
  }
  if (typeof value === 'number' || typeof value === 'boolean') return [String(value)];
  if (Array.isArray(value)) {
    return value.flatMap((item) => collectReadableText(item, maxLines)).slice(0, maxLines);
  }

  const record = value as Record<string, unknown>;
  const errorMessage = readNestedString(record, ['error', 'message']) || readNestedString(record, ['message']);
  if (errorMessage) return createDetailLines(errorMessage, maxLines);

  const dataContentLines = collectContentArray(record.data, maxLines);
  if (dataContentLines.length > 0) return dataContentLines;

  const directContentLines = collectContentArray(record.content, maxLines);
  if (directContentLines.length > 0) return directContentLines;

  for (const key of ['result', 'text', 'stdout', 'stderr']) {
    const nested = collectReadableText(record[key], maxLines);
    if (nested.length > 0) return nested;
  }

  for (const key of ['results', 'entries', 'files', 'items', 'matches']) {
    const nested = collectReadableText(readNestedValue(record, ['data', key]) ?? record[key], maxLines);
    if (nested.length > 0) return nested;
  }

  const detailsResults = collectReadableText(readNestedValue(record, ['data', 'details', 'results']), maxLines);
  if (detailsResults.length > 0) return detailsResults;

  return [];
};

const collectContentArray = (value: unknown, maxLines = 6): string[] => {
  if (!value || typeof value !== 'object') return [];
  const content = Array.isArray(value)
    ? value
    : (value as Record<string, unknown>).content;
  if (!Array.isArray(content)) return [];

  return content.flatMap((item) => {
    if (item && typeof item === 'object') {
      return createDetailLines(stringifyPreview((item as Record<string, unknown>).text), maxLines);
    }
    return createDetailLines(stringifyPreview(item), maxLines);
  }).slice(0, maxLines);
};

const toRecord = (value: unknown): Record<string, unknown> | null => (
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
);

const readNestedValue = (record: Record<string, unknown>, path: string[]): unknown => (
  path.reduce<unknown>((current, key) => (
    current && typeof current === 'object' ? (current as Record<string, unknown>)[key] : undefined
  ), record)
);

const readNestedString = (record: Record<string, unknown>, path: string[]): string => {
  const value = readNestedValue(record, path);
  return typeof value === 'string' ? value : '';
};

const parsePreview = (value?: string): unknown => {
  let text = value?.trim();
  if (!text) return undefined;

  for (let depth = 0; depth < 3; depth += 1) {
    try {
      const parsed = JSON.parse(text);
      if (typeof parsed === 'string' && isJsonLike(parsed) && parsed.trim() !== text) {
        text = parsed.trim();
        continue;
      }
      return parsed;
    } catch {
      return text;
    }
  }

  return text;
};

const prettyPrint = (value?: string): string => {
  const parsed = parsePreview(value);
  if (parsed === undefined) return '';
  if (typeof parsed === 'string') return parsed;
  return JSON.stringify(parsed, null, 2);
};

const stringifyPreview = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
};

const LINE_NUMBER_GUTTER = /^\s*\d+\s*(?:->|\||>)\s?/;

const stripLineNumberGutter = (line: string): string => line.replace(LINE_NUMBER_GUTTER, '');

const createDetailLines = (value?: string, maxLines = 8): string[] => {
  const text = value?.trim();
  if (!text) return [];
  const lines = text
    .split(/\r?\n/)
    .map((line) => stripLineNumberGutter(line.trimEnd()))
    .filter(Boolean);
  const visible = lines.slice(0, maxLines);
  if (lines.length > maxLines) {
    visible.push(`... ${lines.length - maxLines} more lines`);
  }
  return visible;
};

const isLikelyBinaryText = (value: string): boolean => {
  const text = value.slice(0, 2000);
  if (text.length < 16) return false;
  const escapeSeqs = (text.match(/\\u[0-9a-fA-F]{4}/g) ?? []).length;
  const replacementChars = (text.match(/\uFFFD/g) ?? []).length;
  if (escapeSeqs < 4 && replacementChars < 4) return false;
  const noisyChars = escapeSeqs * 6 + replacementChars;
  return noisyChars / text.length > 0.3;
};

const compactText = (value: string, maxLength: number): string => {
  const text = value.trim().replace(/\s+/g, ' ');
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 3))}...`;
};

const extractContentTextFromJsonishString = (value: string): string => {
  const escapedTextMatch = value.match(/\\"content\\"\s*:\s*\[[\s\S]*?\\"text\\"\s*:\s*\\"([\s\S]*)/);
  if (escapedTextMatch?.[1]) {
    return decodeJsonStringFragment(stripEscapedJsonTail(escapedTextMatch[1]));
  }

  const plainTextMatch = value.match(/"content"\s*:\s*\[[\s\S]*?"text"\s*:\s*"([\s\S]*)/);
  if (plainTextMatch?.[1]) {
    return decodeJsonStringFragment(stripPlainJsonTail(plainTextMatch[1]));
  }

  const candidates = [
    value,
    value.replace(/\\"/g, '"').replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\t/g, '\t'),
  ];

  for (const candidate of candidates) {
    const looseMatch = candidate.match(/"content"\s*:\s*\[[\s\S]*?"text"\s*:\s*"([\s\S]*)"\s*\}\s*\]\s*(?:,|\})/);
    if (looseMatch?.[1]) return decodeJsonStringFragment(looseMatch[1]);

    const strictMatch = candidate.match(/"content"\s*:\s*\[[\s\S]*?"text"\s*:\s*"((?:\\.|[^"\\])*)"/);
    if (strictMatch?.[1]) return decodeJsonStringFragment(strictMatch[1]);
  }

  return '';
};

const stripEscapedJsonTail = (value: string): string => {
  const tailIndex = value.search(/\\"\s*\}\s*\]\s*(?:,|\})/);
  return tailIndex >= 0 ? value.slice(0, tailIndex) : value;
};

const stripPlainJsonTail = (value: string): string => {
  const tailIndex = value.search(/"\s*\}\s*\]\s*(?:,|\})/);
  return tailIndex >= 0 ? value.slice(0, tailIndex) : value;
};

const decodeJsonStringFragment = (value: string): string => {
  try {
    const parsed = JSON.parse(`"${value.replace(/\r?\n/g, '\\n')}"`);
    return typeof parsed === 'string' ? decodeEscapedText(parsed) : String(parsed);
  } catch {
    return decodeEscapedText(value);
  }
};

const decodeEscapedText = (value: string): string => (
  value
    .replace(/\\\\n/g, '\n')
    .replace(/\\\\r/g, '\r')
    .replace(/\\\\t/g, '\t')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\+"/g, '"')
    .replace(/\\\\/g, '\\')
);

const isJsonLike = (value: string): boolean => {
  const text = value.trim();
  return text.startsWith('{') || text.startsWith('[');
};
