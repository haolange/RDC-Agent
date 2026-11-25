import type { ConversationMessage, ConversationWorkBlock, ConversationWorkTrace } from '@shared/types/conversation';
import type { ConversationBranchState } from '@shared/types/conversationBranch';
import type { SessionAttachmentRecord, SessionRecord } from '@shared/types/session';
import type { SessionContextTurnEntry } from '../../agent-runtime/context/SessionContextJournal';

export interface ConversationTurnCommitJournal {
  schemaVersion: '1';
  requestId: string;
  turnId: string;
  phase: 'prepared' | 'committing' | 'committed';
  beforeHistory: ConversationMessage[];
  beforeBranch: ConversationBranchState | null;
  beforeAttachments: SessionAttachmentRecord[];
  afterHistory?: ConversationMessage[];
  afterBranch?: ConversationBranchState | null;
  afterAttachments: SessionAttachmentRecord[];
  importedPaths: string[];
}

export interface ConversationTerminalCommitJournal {
  schemaVersion: '1';
  requestId: string;
  turnId: string;
  phase: 'prepared' | 'committing' | 'committed';
  beforeHistory: ConversationMessage[];
  beforeBranch: ConversationBranchState | null;
  beforeContext: SessionContextTurnEntry[];
  afterHistory: ConversationMessage[];
  afterBranch: ConversationBranchState | null;
  afterContext: SessionContextTurnEntry[];
}

/** Append-only terminal WAL; session/history/context formats are unchanged. */
export interface ConversationTerminalAppendJournal {
  schemaVersion: '2';
  requestId: string;
  turnId: string;
  phase: 'prepared' | 'committing' | 'committed';
  history: TerminalAppendFile;
  context: TerminalAppendFile;
}

export interface TerminalAppendFile {
  existed: boolean;
  bytes: number;
  sha256: string;
  append: string;
}

/**
 * A work-trace update stored as the blocks it changed. The reader rebuilds the trace from the previous
 * one, so a long turn appends each streaming block once per change instead of the whole trace.
 */
export interface ConversationTraceBlocksPatch {
  status: ConversationWorkTrace['status'];
  summary?: string;
  toolEvidence?: ConversationWorkTrace['toolEvidence'];
  updatedAt: number;
  /** Every block id, in trace order. */
  blockIds: string[];
  changedBlocks: ConversationWorkBlock[];
}

export interface ConversationDeltaRecord {
  op: 'delta';
  id: string;
  patch: Partial<ConversationMessage>;
  traceBlocks?: ConversationTraceBlocksPatch;
  updatedAt: number;
}

export interface ConversationHistoryCacheEntry {
  mtimeMs: number;
  size: number;
  messages: ConversationMessage[];
  rawRecordCount: number;
}

export const CONVERSATION_COMPACTION_DELTA_THRESHOLD = 24;

export interface ExistingConversationTurnCommit {
  session: SessionRecord;
  requestId: string;
  turnId: string;
  attachments: SessionAttachmentRecord[];
  beforeHistory: ConversationMessage[];
  beforeBranch: ConversationBranchState | null;
}

export interface StagedConversationSessionCommit {
  session: SessionRecord;
  requestId: string;
  turnId: string;
  stagingPath: string;
  finalPath: string;
  attachments: SessionAttachmentRecord[];
}

export interface ReservedStagedConversationSession {
  session: SessionRecord;
  requestId: string;
  turnId: string;
  stagingPath: string;
  finalPath: string;
}
