/**
 * Composition root of session storage. One StorageIo and the store that owns each file family, wired once:
 * the project registry and selection (`projectWorkspaceStore`), session and run records (`sessionRecordStore`),
 * conversation history, branches and attachments (`conversationHistoryStore`), per-session context files
 * (`sessionContextStore`) and the approved execution offer (`executionOfferStore`). Callers import the store
 * that owns the data they read or write.
 */

import { ExecutionOfferStore } from '../run/ExecutionOfferStore';
import { StorageIo } from '../../runtime/StorageIo';
import { ProjectWorkspaceStore } from './ProjectWorkspaceStore';
import { SessionRecordStore } from './SessionRecordStore';
import { ConversationHistoryStore } from './ConversationHistoryStore';
import { SessionContextStore } from './SessionContextStore';

export const storageIo = new StorageIo();
export const projectWorkspaceStore = new ProjectWorkspaceStore(storageIo);
export const sessionRecordStore = new SessionRecordStore({ io: storageIo, projects: projectWorkspaceStore });
export const sessionContextStore = new SessionContextStore({ io: storageIo, sessions: sessionRecordStore });
export const conversationHistoryStore = new ConversationHistoryStore({
  io: storageIo,
  sessions: sessionRecordStore,
  projects: projectWorkspaceStore,
  context: sessionContextStore,
});
export const executionOfferStore = new ExecutionOfferStore({ io: storageIo, sessions: sessionRecordStore });

sessionRecordStore.connect({ attachments: conversationHistoryStore, removedHandoffState: executionOfferStore });
projectWorkspaceStore.connect({ sessions: sessionRecordStore, turnCommits: conversationHistoryStore });
projectWorkspaceStore.syncRuntimePaths();
