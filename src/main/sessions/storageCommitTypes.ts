import type { ConversationMessage } from '@shared/types/conversation';
import type { ConversationBranchState } from '@shared/types/conversationBranch';
import type { SessionAttachmentRecord, SessionRecord } from '@shared/types/session';
import type { SessionContextTurnEntry } from '../conversation/SessionContextJournal';

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

export interface ConversationDeltaRecord {
  op: 'delta';
  id: string;
  patch: Partial<ConversationMessage>;
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
