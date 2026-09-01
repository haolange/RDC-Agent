import type { StorageIo } from './StorageIo';
import type { ProjectWorkspaceStore } from './ProjectWorkspaceStore';
import type { SessionRecordStore } from './SessionRecordStore';
import type { ConversationHistoryStore } from './ConversationHistoryStore';
import type { SessionContextStore } from './SessionContextStore';
import type { HandoffStateStore } from './HandoffStateStore';
import type { ConversationHistoryCacheEntry } from './storageCommitTypes';

export interface StorageHost {
  readonly io: StorageIo;
  dataRootPath: string;
  projectsRootPath: string;
  globalKnowledgePath: string;
  registryPath: string;
  selectionPath: string;
  readonly turnCommitSessionIds: Set<string>;
  readonly terminalCommitSessionIds: Set<string>;
  readonly conversationHistoryCache: Map<string, ConversationHistoryCacheEntry>;
  readonly conversationPendingDeltaCounts: Map<string, number>;
  projects: ProjectWorkspaceStore;
  sessions: SessionRecordStore;
  history: ConversationHistoryStore;
  context: SessionContextStore;
  handoffs: HandoffStateStore;
}
