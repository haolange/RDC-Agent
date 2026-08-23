import type { ConversationMessage } from '@shared/types/conversation';
import { ROOT_BRANCH_ID } from '@shared/types/conversationBranch';
import type { DerivedContextView } from '@shared/types/semanticContext';
import { resolveCompactionThresholdTokens } from '@shared/utils/contextBudget';
import { nowMs } from '@shared/utils/id';
import {
  persistGeneratedSessionCompaction,
  SESSION_COMPACTION_KEEP_RECENT_TURNS,
} from '../agent-runtime/context/CompactionHandoffService';
import { storageAdapter } from '../sessions/StorageAdapter';
import { resolveCompactionPercentForSession } from '../settings/compactionPercent';
import {
  repairConversationBranchState,
  resolveVisibleConversationMessages,
} from './ConversationBranchResolver';
import { sessionContextJournal } from './SessionContextJournal';
import { publishConversationTrace, publishTraceProjection } from './ConversationTurnTerminal';
import { upsertWorkBlock } from './ConversationWorkTrace';

export async function compactConversationHistory(sessionId: string): Promise<{
  status: 'noop' | 'compacted';
  messages: ConversationMessage[];
  contextView: DerivedContextView | null;
  occupiedTokens: number;
  compactionThresholdTokens: number;
}> {
  const history = storageAdapter.readConversationHistory(sessionId);
  const current = storageAdapter.readConversationBranchState(sessionId);
  const { branchState, repaired } = repairConversationBranchState(history, current);
  if (branchState && repaired) {
    storageAdapter.writeConversationBranchState(sessionId, branchState);
  }
  const visibleMessages = branchState
    ? resolveVisibleConversationMessages(history, branchState)
    : history;
  const journalTurnIds = new Set(sessionContextJournal.readEntries(sessionId).map((entry) => entry.turnId));
  const visibleTurnIds = Array.from(new Set(
    visibleMessages
      .map((message) => message.turnId)
      .filter((turnId) => journalTurnIds.has(turnId)),
  ));
  const usage = storageAdapter.readSessionUsage(sessionId);
  const occupiedTokens = usage?.occupiedTokens ?? 0;
  const compactionThresholdTokens = typeof usage?.compactionThresholdTokens === 'number'
    && usage.compactionThresholdTokens > 0
    ? usage.compactionThresholdTokens
    : typeof usage?.promptBudgetTokens === 'number' && usage.promptBudgetTokens > 0
      ? resolveCompactionThresholdTokens(
        usage.promptBudgetTokens,
        resolveCompactionPercentForSession(sessionId),
      )
      : 0;
  const contextView = await persistGeneratedSessionCompaction({
    sessionId,
    history,
    visibleTurnIds,
    branchId: branchState?.activeLeafBranchId ?? ROOT_BRANCH_ID,
    occupiedTokens,
    compactionThresholdTokens,
    keepRecentTurns: SESSION_COMPACTION_KEEP_RECENT_TURNS,
  });
  if (!contextView) {
    return {
      status: 'noop',
      messages: history,
      contextView: null,
      occupiedTokens,
      compactionThresholdTokens,
    };
  }
  const lastAssistant = [...history].reverse().find((message) => message.role === 'assistant');
  if (lastAssistant) {
    lastAssistant.workTrace = upsertWorkBlock(lastAssistant.workTrace, `compaction-manual-${nowMs()}`, {
      kind: 'compaction',
      title: '手动压缩',
      stage: 'context',
      status: 'complete',
      summary: '手动压缩',
      compactionStats: {
        provenance: 'manual',
        messagesBefore: visibleMessages.length,
        tokensBefore: occupiedTokens,
      },
      completedAt: nowMs(),
    });
    storageAdapter.writeConversationHistory(sessionId, history);
    publishConversationTrace(sessionId, history, sessionId, publishTraceProjection);
  }
  return {
    status: 'compacted',
    messages: history,
    contextView,
    occupiedTokens,
    compactionThresholdTokens,
  };
}
