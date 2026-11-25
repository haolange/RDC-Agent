import { DEFAULT_AGENT_ID } from '@shared/types/agent';
import { useProjectStore } from '../stores/projectStore';
import { getCurrentSessionView, useSessionRecordStore } from '../stores/sessionRecordStore';
import {
  composerNoSessionScopeKey,
  readComposerDraftAgent,
  useComposerModelDraftStore,
} from '../stores/composerModelDraftStore';

/**
 * The Agent pill, derived and never stored twice: the current session's Agent with an in-flight switch on top, or,
 * before the project has a session, its Composer draft. Missing means General.
 */
export function useComposerAgentId(): string {
  const sessionId = useProjectStore((state) => state.currentSessionId);
  const projectId = useProjectStore((state) => state.currentProject?.projectId);
  const sessionAgentId = useSessionRecordStore((state) => (sessionId ? state.views[sessionId]?.agentId : undefined));
  const draftAgentId = useComposerModelDraftStore((state) => (
    sessionId ? undefined : state.agentDraftByScope[composerNoSessionScopeKey(projectId)]
  ));
  return (sessionId ? sessionAgentId : draftAgentId)?.trim() || DEFAULT_AGENT_ID;
}

export function readComposerAgentId(): string {
  const { currentSessionId, currentProject } = useProjectStore.getState();
  const agentId = currentSessionId ? getCurrentSessionView()?.agentId : readComposerDraftAgent(currentProject?.projectId);
  return agentId?.trim() || DEFAULT_AGENT_ID;
}
