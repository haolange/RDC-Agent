import type {
  ConversationLoopResult,
  ConversationLoopResultStatus,
  ConversationToolCall,
  ConversationWorkBlock,
  ConversationWorkTrace,
} from '@shared/types/conversation';
import type { ThinkingArtifact } from '@shared/types/reasoning';
import { nowMs } from '@shared/utils/id';
import { normalizeToolName } from '../workflow/debugger/DebuggerRuntimePolicy';

const WORK_BLOCK_KINDS = new Set<ConversationWorkBlock['kind']>([
  'reasoning',
  'llm_turn',
  'approval',
  'user_input',
  'compaction',
  'subagent',
  'handoff',
  'diagnostic',
  'output',
  'command',
]);

interface LoopTraceOptions {
  loopId?: string;
  loopResultText?: string;
  loopResultStatus?: ConversationLoopResultStatus;
  loopFinishReason?: string;
  loopThinking?: ThinkingArtifact;
  loopThinkingStatus?: ConversationWorkBlock['thinkingStatus'];
}

function normalizeWorkBlockKind(value: unknown): ConversationWorkBlock['kind'] {
  if (value === 'tool') return 'llm_turn';
  return WORK_BLOCK_KINDS.has(value as ConversationWorkBlock['kind'])
    ? value as ConversationWorkBlock['kind']
    : 'diagnostic';
}
function createWorkBlock(
  id: string,
  title: string,
  stage?: string,
  kind: ConversationWorkBlock['kind'] = 'reasoning',
): ConversationWorkBlock {
  const block: ConversationWorkBlock = {
    id,
    kind: normalizeWorkBlockKind(kind),
    title,
    stage,
    status: 'pending',
    toolCalls: [],
    startedAt: nowMs(),
  };
  if (block.kind === 'llm_turn') {
    block.result = createLoopResult(undefined, block.status, []);
  }
  return block;
}

export function createDraftWorkTrace(summary?: string, blocks: ConversationWorkBlock[] = []): ConversationWorkTrace {
  return {
    status: 'running',
    summary,
    blocks: blocks.map(cloneWorkBlock),
    updatedAt: nowMs(),
  };
}

function cloneToolCall(toolCall: ConversationToolCall): ConversationToolCall {
  return {
    ...toolCall,
    approval: toolCall.approval ? { ...toolCall.approval } : undefined,
  };
}

function cloneThinkingArtifact(thinking: ThinkingArtifact | undefined): ThinkingArtifact | undefined {
  return thinking
    ? {
        ...thinking,
        artifact: thinking.artifact
          ? {
              ...thinking.artifact,
              raw: thinking.artifact.raw ? { ...thinking.artifact.raw } : undefined,
            }
          : undefined,
      }
    : undefined;
}

function cloneLoopResult(result: ConversationLoopResult | undefined): ConversationLoopResult | undefined {
  return result
    ? {
        ...result,
        toolCallIds: result.toolCallIds.slice(),
      }
    : undefined;
}

function cloneWorkBlock(block: ConversationWorkBlock): ConversationWorkBlock {
  const legacyBlock = block as ConversationWorkBlock & { thinkingPresentation?: unknown };
  const { thinkingPresentation: _legacyThinkingPresentation, ...knownBlock } = legacyBlock;
  const toolCalls = block.toolCalls.map(cloneToolCall);
  const normalizedKind = normalizeWorkBlockKind((knownBlock as { kind?: unknown }).kind);
  const thinking = cloneThinkingArtifact(block.thinking) ?? normalizeLegacyThinkingArtifact(legacyBlock);
  const thinkingStatus = knownBlock.thinkingStatus ?? (thinking ? 'complete' : undefined);
  const result = normalizedKind === 'llm_turn'
    ? normalizeLoopResult(knownBlock.result, knownBlock.summary, knownBlock.status, toolCalls)
    : cloneLoopResult(knownBlock.result);
  return {
    ...knownBlock,
    kind: normalizedKind,
    ...(thinking ? { thinking } : {}),
    ...(thinkingStatus ? { thinkingStatus } : {}),
    ...(result ? { result } : {}),
    toolCalls,
    children: block.children?.map(cloneWorkBlock),
  };
}

function cloneTrace(trace: ConversationWorkTrace | null | undefined): ConversationWorkTrace {
  return trace
    ? {
        ...trace,
        blocks: trace.blocks.map(cloneWorkBlock),
      }
    : {
        status: 'idle',
        blocks: [],
        updatedAt: nowMs(),
      };
}

export function upsertWorkBlock(
  trace: ConversationWorkTrace | null | undefined,
  blockId: string,
  patch: Partial<ConversationWorkBlock>,
): ConversationWorkTrace {
  const nextTrace = cloneTrace(trace);
  const blockIndex = nextTrace.blocks.findIndex((block) => block.id === blockId);
  if (blockIndex >= 0) {
    nextTrace.blocks[blockIndex] = cloneWorkBlock({
      ...nextTrace.blocks[blockIndex],
      ...patch,
      toolCalls: patch.toolCalls
        ? patch.toolCalls.map(cloneToolCall)
        : nextTrace.blocks[blockIndex].toolCalls.map(cloneToolCall),
    });
  } else {
    nextTrace.blocks.push(cloneWorkBlock({
      ...createWorkBlock(blockId, patch.title || blockId, patch.stage, patch.kind),
      ...patch,
      kind: normalizeWorkBlockKind(patch.kind ?? 'reasoning'),
      toolCalls: patch.toolCalls ? patch.toolCalls.map(cloneToolCall) : [],
    }));
  }
  nextTrace.updatedAt = nowMs();
  return nextTrace;
}

export function finalizeTrace(
  trace: ConversationWorkTrace | null | undefined,
  status: ConversationWorkTrace['status'],
  summary?: string,
): ConversationWorkTrace {
  const nextTrace = cloneTrace(trace);
  const terminalBlockStatus: ConversationWorkBlock['status'] | null =
    status === 'complete'
      ? 'complete'
      : status === 'error' || status === 'stopped'
        ? 'error'
        : null;

  if (terminalBlockStatus) {
    const terminalAt = nowMs();
    nextTrace.blocks = nextTrace.blocks.map((block) => {
      const blockStatus = block.status === 'pending' || block.status === 'running'
        ? terminalBlockStatus
        : block.status;
      const blockCompletedAt = block.completedAt ?? terminalAt;
      const toolCalls = block.toolCalls.map((toolCall) => {
        if (toolCall.status !== 'pending' && toolCall.status !== 'running') {
          return cloneToolCall(toolCall);
        }
        return {
          ...cloneToolCall(toolCall),
          status: terminalBlockStatus,
          completedAt: toolCall.completedAt ?? terminalAt,
          error: terminalBlockStatus === 'error'
            ? (toolCall.error ?? 'Run ended before this tool call completed.')
            : toolCall.error,
        };
      });
      const result = block.kind === 'llm_turn'
        ? {
            ...ensureLoopResult({ ...block, toolCalls }),
            status: 'complete' as const,
            toolCallIds: uniqueStrings([...(block.result?.toolCallIds ?? []), ...toolCalls.map((toolCall) => toolCall.id)]),
          }
        : block.result;
      return {
        ...block,
        status: blockStatus,
        completedAt: blockCompletedAt,
        ...(result ? { result } : {}),
        toolCalls,
      };
    });
  }

  nextTrace.status = status;
  nextTrace.summary = summary ?? nextTrace.summary;
  nextTrace.updatedAt = nowMs();
  return nextTrace;
}

export function upsertRuntimeToolCall(
  trace: ConversationWorkTrace | null | undefined,
  patch: Partial<ConversationToolCall> & { id: string; toolName: string },
  options?: LoopTraceOptions,
): ConversationWorkTrace {
  const nextTrace = cloneTrace(trace);
  const blockMeta = getRuntimeToolBlockMeta(patch.toolName, options?.loopId);
  const blockId = blockMeta.id;
  let block = nextTrace.blocks.find((entry) => entry.id === blockId);
  if (!block) {
    block = createWorkBlock(blockId, blockMeta.title, blockMeta.stage, blockMeta.kind);
    block.status = 'running';
    nextTrace.blocks.push(block);
  }
  if (options?.loopId && blockId === options.loopId) {
    applyLoopFields(block, options);
  }
  const toolIndex = block.toolCalls.findIndex((toolCall) => toolCall.id === patch.id);
  if (toolIndex >= 0) {
    const existingToolCall = block.toolCalls[toolIndex];
    const nextApproval = patch.approval
      ? { ...(existingToolCall.approval ?? {}), ...patch.approval }
      : existingToolCall.approval ? { ...existingToolCall.approval } : undefined;
    block.toolCalls[toolIndex] = {
      ...existingToolCall,
      ...patch,
      approval: nextApproval,
    };
  } else {
    block.toolCalls.push({
      id: patch.id,
      toolName: patch.toolName,
      status: patch.status ?? 'pending',
      argsPreview: patch.argsPreview,
      resultPreview: patch.resultPreview,
      error: patch.error,
      approval: patch.approval ? { ...patch.approval } : undefined,
      startedAt: patch.startedAt ?? nowMs(),
      completedAt: patch.completedAt,
    });
  }
  syncLoopResultToolIds(block);
  if (block.toolCalls.length > 0 && block.toolCalls.every((toolCall) => toolCall.status === 'complete' || toolCall.status === 'error')) {
    block.status = block.toolCalls.some((toolCall) => toolCall.status === 'error') ? 'error' : 'complete';
    block.completedAt = nowMs();
    if (block.kind === 'llm_turn') {
      block.result = { ...ensureLoopResult(block), status: 'complete' };
    }
  }
  nextTrace.status = 'running';
  nextTrace.updatedAt = nowMs();
  return nextTrace;
}

export function upsertRuntimeToolApproval(
  trace: ConversationWorkTrace | null | undefined,
  input: {
    approvalId: string;
    toolCallId: string;
    toolName: string;
    status: string;
    reason?: string;
    risk?: unknown;
    reviewer?: unknown;
    answer?: unknown;
  },
  options?: LoopTraceOptions,
): ConversationWorkTrace {
  const status = normalizeToolApprovalStatus(input.status);
  const failed = status === 'rejected' || status === 'cancelled';
  const existingToolCall = trace?.blocks
    .flatMap((block) => block.toolCalls)
    .find((toolCall) => toolCall.id === input.toolCallId);
  const now = nowMs();
  const approval: NonNullable<ConversationToolCall['approval']> = {
    approvalId: input.approvalId,
    status,
  };
  if (input.reason) approval.reason = input.reason;
  const risk = stringifyApprovalField(input.risk);
  if (risk) approval.risk = risk as NonNullable<ConversationToolCall['approval']>['risk'];
  const reviewer = stringifyApprovalField(input.reviewer);
  if (reviewer) approval.reviewer = reviewer as NonNullable<ConversationToolCall['approval']>['reviewer'];
  const answer = stringifyApprovalField(input.answer);
  if (answer) approval.answer = answer;
  if (status === 'pending') approval.requestedAt = now;
  if (status !== 'pending') approval.resolvedAt = now;

  const toolPatch: Partial<ConversationToolCall> & { id: string; toolName: string } = {
    id: input.toolCallId,
    toolName: input.toolName,
    status: failed
      ? 'error'
      : existingToolCall?.status === 'complete'
        ? 'complete'
        : 'running',
    approval,
  };
  if (failed) {
    toolPatch.error = answer || input.reason || 'Tool approval was denied.';
    toolPatch.completedAt = now;
  }

  return upsertRuntimeToolCall(trace, toolPatch, options);
}

function normalizeToolApprovalStatus(status: string): NonNullable<ConversationToolCall['approval']>['status'] {
  if (status === 'approved') return 'approved';
  if (status === 'rejected') return 'rejected';
  if (status === 'cancelled') return 'cancelled';
  return 'pending';
}

function stringifyApprovalField(value: unknown): string {
  if (value === undefined || value === null) return '';
  return typeof value === 'string' ? value.trim() : String(value).trim();
}

function applyLoopFields(block: ConversationWorkBlock, options: LoopTraceOptions): void {
  if (block.kind === 'llm_turn') {
    const result = ensureLoopResult(block);
    const nextText = options.loopResultText?.trim();
    if (nextText && (!result.text || nextText.length >= result.text.length)) {
      result.text = nextText;
    }
    if (options.loopResultStatus) {
      result.status = options.loopResultStatus;
    }
    if (options.loopFinishReason) {
      result.finishReason = options.loopFinishReason;
    }
    block.result = result;
  }
  const nextThinking = cloneThinkingArtifact(options.loopThinking);
  if (nextThinking && shouldReplaceThinking(block.thinking, nextThinking)) {
    block.thinking = nextThinking;
  }
  if (options.loopThinkingStatus && (nextThinking || block.thinking)) {
    block.thinkingStatus = options.loopThinkingStatus;
  }
}

export function upsertLoopResult(
  trace: ConversationWorkTrace | null | undefined,
  loopId: string,
  resultText?: string,
  thinking?: ThinkingArtifact,
  thinkingStatus?: ConversationWorkBlock['thinkingStatus'],
  resultStatus: ConversationLoopResultStatus = 'streaming',
  finishReason?: string,
): ConversationWorkTrace {
  const nextTrace = cloneTrace(trace);
  let block = nextTrace.blocks.find((entry) => entry.id === loopId);
  if (!block) {
    block = createWorkBlock(loopId, 'LLM turn', 'model', 'llm_turn');
    block.status = 'running';
    nextTrace.blocks.push(block);
  }
  applyLoopFields(block, {
    loopId,
    loopResultText: resultText,
    loopResultStatus: resultStatus,
    loopFinishReason: finishReason,
    loopThinking: thinking,
    loopThinkingStatus: thinkingStatus,
  });
  nextTrace.status = 'running';
  nextTrace.updatedAt = nowMs();
  return nextTrace;
}

function ensureLoopResult(block: ConversationWorkBlock): ConversationLoopResult {
  const status: ConversationLoopResultStatus = block.status === 'running' || block.status === 'pending' ? 'streaming' : 'complete';
  const result = normalizeLoopResult(block.result, block.summary, status, block.toolCalls);
  block.result = result;
  return result;
}

function createLoopResult(
  text: string | undefined,
  blockStatus: ConversationWorkBlock['status'] | ConversationLoopResultStatus,
  toolCalls: ConversationToolCall[],
): ConversationLoopResult {
  return normalizeLoopResult(undefined, text, blockStatus, toolCalls);
}

function normalizeLoopResult(
  result: ConversationLoopResult | undefined,
  fallbackText: string | undefined,
  blockStatus: ConversationWorkBlock['status'] | ConversationLoopResultStatus,
  toolCalls: ConversationToolCall[],
): ConversationLoopResult {
  const status: ConversationLoopResultStatus = result?.status
    ?? (blockStatus === 'running' || blockStatus === 'pending' || blockStatus === 'streaming' ? 'streaming' : 'complete');
  const text = result?.text ?? fallbackText?.trim() ?? undefined;
  return {
    ...(text ? { text } : {}),
    ...(result?.finishReason ? { finishReason: result.finishReason } : {}),
    status,
    toolCallIds: uniqueStrings([...(result?.toolCallIds ?? []), ...toolCalls.map((toolCall) => toolCall.id)]),
  };
}

function syncLoopResultToolIds(block: ConversationWorkBlock): void {
  if (block.kind !== 'llm_turn') return;
  const result = ensureLoopResult(block);
  result.toolCallIds = uniqueStrings([...result.toolCallIds, ...block.toolCalls.map((toolCall) => toolCall.id)]);
  block.result = result;
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function shouldReplaceThinking(current: ThinkingArtifact | undefined, next: ThinkingArtifact): boolean {
  if (!current) return true;
  if (next.replayPolicy === 'provider-artifact' && !current.artifact) return true;
  if (next.artifact && JSON.stringify(next.artifact) !== JSON.stringify(current.artifact)) return true;
  return (next.text?.length ?? 0) >= (current.text?.length ?? 0);
}

function normalizeLegacyThinkingArtifact(
  block: ConversationWorkBlock & { thinkingPresentation?: unknown },
): ThinkingArtifact | undefined {
  const detail = typeof block.detail === 'string' ? block.detail.trim() : '';
  const presentation = block.thinkingPresentation;
  if (!detail || (presentation !== 'summary' && presentation !== 'full')) return undefined;
  return {
    text: detail,
    kind: presentation === 'summary' ? 'summary' : 'raw',
    source: 'unknown',
    visibility: presentation === 'summary' ? 'summary' : 'raw-collapsed',
    replayPolicy: 'none',
  };
}

function getRuntimeToolBlockMeta(
  toolName: string,
  loopId?: string,
): Pick<ConversationWorkBlock, 'id' | 'title' | 'stage' | 'kind'> {
  const normalizedToolName = normalizeToolName(toolName);
  if (normalizedToolName === 'ask_user') {
    return {
      id: 'runtime-user-input',
      title: 'User input requested',
      stage: 'decision',
      kind: 'user_input',
    };
  }
  if (normalizedToolName === 'agent_handoff') {
    return {
      id: 'runtime-handoff',
      title: 'Preparing handoff',
      stage: 'handoff',
      kind: 'handoff',
    };
  }
  return {
    id: loopId ?? 'runtime-llm-turn',
    title: 'LLM turn',
    stage: 'model',
    kind: 'llm_turn',
  };
}
