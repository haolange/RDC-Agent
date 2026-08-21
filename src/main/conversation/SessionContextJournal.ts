import type { DerivedContextView } from '@shared/types/semanticContext';
import {
  buildDerivedContextView,
  computeContextSourceHash,
  createStructuredHandoffMessage,
} from '../agent-runtime/context/StructuredHandoffBuilder';
import type { AgentRole } from '@shared/types/agent';
import type { ConversationTurnControls } from '@shared/types/modelCapability';
import type { ExecutionIdentity, RequestPlan } from '@shared/types/providerCapability';
import type { ProviderContinuationArtifact } from '@shared/types/reasoning';
import type { AssistantMessage, Message, ToolCall, ToolResultMessage } from '../agent-runtime/core/types';
import {
  decideContinuationReplay,
  type ContinuationReplayAction,
  type ContinuationReplayReason,
} from '../agent-runtime/reasoning/ContinuationReplayPolicy';
import { providerStateReuseReason } from '../agent-runtime/reasoning/ProviderStateRefs';
import { storageAdapter } from '../sessions/StorageAdapter';

export interface SessionContextTurnEntry {
  schemaVersion: 2;
  turnId: string;
  userMessageId: string;
  assistantMessageId: string;
  branchId: string;
  agentId: AgentRole;
  executionIdentity: ExecutionIdentity;
  controls: ConversationTurnControls;
  status: 'complete' | 'stopped' | 'error';
  messages: Message[];
  createdAt: number;
  completedAt: number;
}

export interface SessionContextArtifactDecision {
  messageIndex: number;
  contentIndex: number;
  action: ContinuationReplayAction;
  reason: ContinuationReplayReason;
  originFingerprint?: string;
}

export interface SessionContextMaterialization {
  messages: Message[];
  selectedTurnCount: number;
  replayedArtifactCount: number;
  filteredArtifactCount: number;
  artifactDecisions: SessionContextArtifactDecision[];
  derivedContextStatus: 'none' | 'applied' | 'stale';
  derivedContextView?: DerivedContextView;
  compactedTurnCount: number;
}

/**
 * Continuation 制品回放的 turn 数上限：只回放最近 N 个可见 turn 内的制品，
 * 更旧的落盘保留但不回放（防连续长会话 token bomb）。
 */
export const CONTINUATION_RETENTION_TURNS = 8;

export const filterSessionContextMessageArtifacts = (
  message: Message,
  requestPlan: RequestPlan,
  messageIndex = 0,
  withinRetention = true,
): { message: Message; filtered: number; replayed: number; decisions: SessionContextArtifactDecision[] } => {
  if (message.role !== 'assistant') return { message, filtered: 0, replayed: 0, decisions: [] };
  let filtered = 0;
  let replayed = 0;
  const decisions: SessionContextArtifactDecision[] = [];
  const content = message.content.reduce<AssistantMessage['content']>((blocks, block, contentIndex) => {
    if (block.type !== 'thinking') {
      blocks.push(block);
      return blocks;
    }
    const decision = withinRetention
      ? decideContinuationReplay(block.continuation, requestPlan, { sameToolLoop: false })
      : { action: 'drop' as const, reason: 'retention-expired' as const };
    decisions.push({
      messageIndex,
      contentIndex,
      ...decision,
      originFingerprint: block.continuation?.originFingerprint,
    });
    if (decision.action === 'replay') {
      replayed += 1;
      blocks.push(block);
    } else filtered += 1;
    return blocks;
  }, []);
  const nextMessage: AssistantMessage = { ...message, content };
  if (
    nextMessage.providerState
    && providerStateReuseReason(nextMessage.providerState, requestPlan) !== 'reusable'
  ) delete nextMessage.providerState;
  return { message: nextMessage, filtered, replayed, decisions };
};

export const canonicalizeTerminalContextMessages = (messages: Message[]): Message[] => {
  const completedToolCalls = new Set(
    messages.filter((message): message is ToolResultMessage => message.role === 'toolResult')
      .map((message) => message.toolCallId),
  );
  const result: Message[] = [];
  for (const message of messages) {
    if (message.role !== 'assistant') {
      result.push(message);
      continue;
    }
    const content = message.content.reduce<AssistantMessage['content']>((blocks, block) => {
      if (block.type === 'toolCall') {
        if (completedToolCalls.has((block as ToolCall).id)) blocks.push(block);
      } else if (block.type === 'thinking') {
        const continuation = sanitizeContinuationForJournal(block.continuation);
        if (continuation) blocks.push({ ...block, text: undefined, continuation });
      } else blocks.push(block);
      return blocks;
    }, []);
    if (content.length > 0) result.push({ ...message, content });
  }
  return result;
};

export const canonicalizeSessionContextTurnEntry = (
  entry: SessionContextTurnEntry,
): SessionContextTurnEntry => ({
  ...entry,
  messages: canonicalizeTerminalContextMessages(entry.messages),
});

export class SessionContextJournal {
  materialize(
    sessionId: string,
    visibleTurnIds: string[],
    requestPlan: RequestPlan,
    activeBranchId?: string,
  ): SessionContextMaterialization {
    const entries = this.readEntries(sessionId);
    const entryByTurn = new Map(entries.map((entry) => [entry.turnId, entry]));
    const missingTurnIds = visibleTurnIds.filter((turnId) => !entryByTurn.has(turnId));
    if (missingTurnIds.length > 0) {
      throw new Error('Session context journal is incomplete for ' + missingTurnIds.length + ' visible turn(s).');
    }

    const storedView = storageAdapter.readSessionDerivedContextView(sessionId);
    let derivedContextStatus: SessionContextMaterialization['derivedContextStatus'] = 'none';
    let appliedView: DerivedContextView | undefined;
    let compactedTurnCount = 0;
    let materializedTurnIds = visibleTurnIds;
    const prefixMessages: Message[] = [];
    if (storedView) {
      const sourceCount = storedView.sourceTurnIds.length;
      const sourceIsPrefix = sourceCount > 0
        && storedView.sourceTurnIds.every((turnId, index) => visibleTurnIds[index] === turnId);
      const retainedFollowSource = storedView.retainedTurnIds.every(
        (turnId, index) => visibleTurnIds[sourceCount + index] === turnId,
      );
      const sourceMessages = sourceIsPrefix
        ? storedView.sourceTurnIds.flatMap((turnId) => entryByTurn.get(turnId)?.messages ?? [])
        : [];
      const sourceHashMatches = sourceIsPrefix
        && computeContextSourceHash(sourceMessages, storedView.sourceTurnIds) === storedView.sourceHash;
      const ownerMatches = storedView.schemaVersion === 1
        && storedView.scope === 'session'
        && storedView.sessionId === sessionId
        && (!activeBranchId || storedView.branchId === activeBranchId);
      if (ownerMatches && sourceHashMatches && retainedFollowSource) {
        derivedContextStatus = 'applied';
        appliedView = storedView;
        compactedTurnCount = sourceCount;
        materializedTurnIds = visibleTurnIds.slice(sourceCount);
        prefixMessages.push(createStructuredHandoffMessage(storedView));
      } else {
        derivedContextStatus = 'stale';
      }
    }

    let filteredArtifactCount = 0;
    let replayedArtifactCount = 0;
    const artifactDecisions: SessionContextArtifactDecision[] = [];
    // Retention 上限：只有最近 N 个可见 turn 的制品才进入回放决策，
    // 更旧的制品留在 journal 但按 retention-expired 丢弃。
    const retentionStartIndex = Math.max(0, visibleTurnIds.length - CONTINUATION_RETENTION_TURNS);
    const retainedForReplay = new Set(visibleTurnIds.slice(retentionStartIndex));
    const messages = materializedTurnIds.flatMap((turnId) => {
      const entry = entryByTurn.get(turnId);
      if (!entry) return [];
      const withinRetention = retainedForReplay.has(turnId);
      return entry.messages.map((message, messageIndex) => {
        const filtered = filterSessionContextMessageArtifacts(message, requestPlan, messageIndex, withinRetention);
        filteredArtifactCount += filtered.filtered;
        replayedArtifactCount += filtered.replayed;
        artifactDecisions.push(...filtered.decisions);
        return filtered.message;
      });
    });
    return {
      messages: [...prefixMessages, ...messages],
      selectedTurnCount: visibleTurnIds.length,
      replayedArtifactCount,
      filteredArtifactCount,
      artifactDecisions,
      derivedContextStatus,
      ...(appliedView ? { derivedContextView: appliedView } : {}),
      compactedTurnCount,
    };
  }

  createDerivedView(
    sessionId: string,
    visibleTurnIds: string[],
    branchId: string,
    occupancy: { occupiedTokens: number; compactionThresholdTokens: number },
    keepRecentTurns = 3,
  ): DerivedContextView | null {
    const withinCompactionLine = occupancy.occupiedTokens <= occupancy.compactionThresholdTokens;
    if (withinCompactionLine || visibleTurnIds.length <= keepRecentTurns) {
      storageAdapter.clearSessionDerivedContextView(sessionId);
      return null;
    }
    const entries = this.readEntries(sessionId);
    const entryByTurn = new Map(entries.map((entry) => [entry.turnId, entry]));
    const missingTurnIds = visibleTurnIds.filter((turnId) => !entryByTurn.has(turnId));
    if (missingTurnIds.length > 0) {
      throw new Error('Cannot compact an incomplete session context journal.');
    }
    const sourceTurnIds = visibleTurnIds.slice(0, -keepRecentTurns);
    const retainedTurnIds = visibleTurnIds.slice(-keepRecentTurns);
    const sourceEntries = sourceTurnIds.map((turnId) => entryByTurn.get(turnId)!);
    const sourceMessages = sourceEntries.flatMap((entry) => entry.messages);
    const messageSourceRefs = sourceEntries.flatMap((entry) =>
      entry.messages.map((_, index) => 'turn:' + entry.turnId + ':message:' + index),
    );
    const view = buildDerivedContextView(sourceMessages, {
      scope: 'session',
      sessionId,
      branchId,
      sourceTurnIds,
      retainedTurnIds,
      messageSourceRefs,
    });
    storageAdapter.writeSessionDerivedContextView(sessionId, view);
    return view;
  }
  append(sessionId: string, entry: SessionContextTurnEntry): void {
    const canonicalEntry = canonicalizeSessionContextTurnEntry(entry);
    const duplicate = this.readEntries(sessionId).find((candidate) => candidate.turnId === entry.turnId);
    if (duplicate) {
      if (JSON.stringify(duplicate) !== JSON.stringify(canonicalEntry)) {
        throw new Error('Conflicting session context entry for turn ' + entry.turnId + '.');
      }
      return;
    }
    storageAdapter.appendSessionContextTurn(sessionId, canonicalEntry);
  }

  readEntries(sessionId: string): SessionContextTurnEntry[] {
    const entries = storageAdapter.readSessionContextJournal(sessionId);
    for (const entry of entries) {
      if (
        entry?.schemaVersion !== 2
        || !entry.turnId?.trim()
        || !entry.userMessageId?.trim()
        || !entry.assistantMessageId?.trim()
        || !entry.branchId?.trim()
        || !entry.executionIdentity?.fingerprint?.trim()
        || !Array.isArray(entry.messages)
      ) throw new Error('Session context journal contains an invalid v2 entry. Clear the session before continuing.');
    }
    return entries;
  }
}

/**
 * 终态落盘的 continuation 制品筛选：只有跨 turn scope
 * （`all-assistant-turns` / `provider-managed`）的制品才值得持久化；
 * `tool-call-turn` / `none` / `unknown` 永远不会跨 turn 回放，直接丢弃。
 *
 * 制品必须整体 verbatim 落盘（含 opaque signature / encrypted / thoughtSignature
 * / redacted / opaqueState / raw payload）：`integrityHash` 覆盖全部字段与
 * origin ExecutionIdentity，任何裁剪都会让回放时的完整性校验 fail-closed。
 * 身份是否匹配由 materialize 时的 `ContinuationReplayPolicy` 决策，不在落盘时预判。
 */
function sanitizeContinuationForJournal(
  artifact: ProviderContinuationArtifact | undefined,
): ProviderContinuationArtifact | undefined {
  if (!artifact) return undefined;
  if (artifact.scope !== 'all-assistant-turns' && artifact.scope !== 'provider-managed') return undefined;
  return artifact;
}

export const sessionContextJournal = new SessionContextJournal();
