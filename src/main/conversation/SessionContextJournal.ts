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
}

/**
 * Continuation 制品回放的 turn 数上限：optional 制品只回放最近 N 个可见 turn。
 * 协议 required 制品不受该窗口限制，只随 compaction 边界终止。
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
    const decision = withinRetention || block.continuation?.requirement === 'required'
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
    _activeBranchId?: string,
  ): SessionContextMaterialization {
    const entries = this.readEntries(sessionId);
    const entryByTurn = new Map(entries.map((entry) => [entry.turnId, entry]));
    const missingTurnIds = visibleTurnIds.filter((turnId) => !entryByTurn.has(turnId));
    if (missingTurnIds.length > 0) {
      throw new Error('Session context journal is incomplete for ' + missingTurnIds.length + ' visible turn(s).');
    }

    let filteredArtifactCount = 0;
    let replayedArtifactCount = 0;
    const artifactDecisions: SessionContextArtifactDecision[] = [];
    // Retention 上限：最近 N 个可见 turn 的制品进入回放；更旧的 optional
    // 制品按 retention-expired 丢弃，required 制品仍走 replay policy。
    const retentionStartIndex = Math.max(0, visibleTurnIds.length - CONTINUATION_RETENTION_TURNS);
    const retainedForReplay = new Set(visibleTurnIds.slice(retentionStartIndex));
    const messages = visibleTurnIds.flatMap((turnId) => {
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
      messages,
      selectedTurnCount: visibleTurnIds.length,
      replayedArtifactCount,
      filteredArtifactCount,
      artifactDecisions,
    };
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
