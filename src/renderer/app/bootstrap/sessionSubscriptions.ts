import type { AgentState, AgentTimelineEntry } from '@shared/types/agent';
import type { ActionEvent } from '@shared/types/evidence';
import type { RunSummary } from '@shared/types/session';
import {
  applyActionEventToMessage,
  mapActionEventToTimelineEntry
} from '../../services/conversationTimeline';
import { useAgentStore } from '../../stores/agentStore';
import { acceptsContextUsage } from '../../stores/contextUsageProjectionModel';
import { useConversationStore } from '../../stores/conversationStore';
import { useNotificationStore } from '../../stores/notificationStore';
import { useProjectStore } from '../../stores/projectStore';
import { isActiveSessionEvent, isActiveSessionScope } from '../../stores/sessionEventGate';
import { useSessionProjectionStore } from '../../stores/sessionProjectionStore';
import { useSessionStore } from '../../stores/sessionStore';
import { useWorkflowStore } from '../../stores/workflowStore';

import type { ElectronAPI } from '@shared/types/electron';
import type { EventBridgeOptions } from './eventBridgeOptions';
const projection = () => useSessionProjectionStore.getState();

/** 类型守卫：判断 IPC 入站对象是否符合 agent:message 的最小契约。 */
const isAgentMessagePayload = (
  value: unknown,
): value is { id?: string; agentRole?: AgentTimelineEntry['agentRole']; content?: string; sessionId?: string } => {
  if (!value || typeof value !== 'object') return false;
  const obj = value as Record<string, unknown>;
  if (obj.id !== undefined && typeof obj.id !== 'string') return false;
  if (obj.content !== undefined && typeof obj.content !== 'string') return false;
  if (obj.sessionId !== undefined && typeof obj.sessionId !== 'string') return false;
  return true;
};

/** 类型守卫：判断 IPC 入站对象是否符合 AgentState 的最小契约。 */
const isAgentStatePayload = (value: unknown): value is AgentState => {
  if (!value || typeof value !== 'object') return false;
  const obj = value as Record<string, unknown>;
  return typeof obj.agentId === 'string'
    && typeof obj.status === 'string'
    && typeof obj.sessionId === 'string'
    && obj.sessionId.trim().length > 0;
};

export function subscribeRunUsageChanged(electronAPI: ElectronAPI) {
  return electronAPI.events.onRunUsageChanged((event) => {
    const currentSession = useProjectStore.getState().currentSession;
    if (!currentSession || currentSession.sessionId !== event.sessionId) {
      projection().projectRunUsage(event.sessionId, event.payload, null);
      return;
    }

    const session = useSessionStore.getState();
    const activeRunId = session.currentRun?.runId ?? null;
    if (!acceptsContextUsage(session, event.payload, activeRunId)) return;

    projection().projectRunUsage(event.sessionId, event.payload, activeRunId);
    session.setCurrentRunUsage(event.payload);
  });
}

export function subscribeTraceProjectionChanged(electronAPI: ElectronAPI) {
  return electronAPI.events.onTraceProjectionChanged((payload) => {
    if (!isActiveSessionScope(payload)) {
      projection().projectTrace(payload.sessionId, payload.presentation);
      return;
    }
    useWorkflowStore.getState().setTracePresentation(payload.presentation);
  });
}

export function subscribeAgentMessage(electronAPI: ElectronAPI) {
  return electronAPI.events.onAgentMessage((rawMsg) => {
    if (!isAgentMessagePayload(rawMsg)) {
      return;
    }
    if (rawMsg.sessionId !== undefined && !isActiveSessionEvent(rawMsg.sessionId)) {
      projection().projectTimelineEntry(rawMsg.sessionId, {
        id: rawMsg.id || Date.now().toString(),
        type: 'agent',
        agentRole: rawMsg.agentRole,
        content: rawMsg.content ?? '',
        timestamp: Date.now(),
      });
      return;
    }
    const entry: AgentTimelineEntry = {
      id: rawMsg.id || Date.now().toString(),
      type: 'agent',
      agentRole: rawMsg.agentRole,
      content: rawMsg.content ?? '',
      timestamp: Date.now(),
    };
    useConversationStore.getState().addTimelineEntry(entry);
  });
}

export function subscribeAgentStatusChanged(electronAPI: ElectronAPI) {
  return electronAPI.events.onAgentStatusChanged((rawState) => {
    if (isAgentStatePayload(rawState)) {
      const sessionId = rawState.sessionId;
      if (typeof sessionId !== 'string' || !sessionId.trim()) {
        return;
      }
      if (!isActiveSessionEvent(sessionId)) {
        return;
      }
      useAgentStore.getState().updateAgentState(rawState);
    }
  });
}

export function subscribeEvidenceEventAdded(electronAPI: ElectronAPI, addActionEvent: (event: ActionEvent) => void) {
  return electronAPI.events.onEvidenceEventAdded((rawEvent) => {
    const event = rawEvent as ActionEvent;
    const sessionId = event.session_id;
    if (!isActiveSessionEvent(sessionId)) {
      return;
    }
    addActionEvent(event);
    const entry = mapActionEventToTimelineEntry(event);
    if (entry) {
      useConversationStore.getState().addTimelineEntry(entry);
    }
    if (event.turn_id) {
      useConversationStore.getState().updateAssistantMessageByTurnId(event.turn_id, (message) => applyActionEventToMessage(message, event));
    }
  });
}

export function subscribeRunStatusChanged(electronAPI: ElectronAPI) {
  return electronAPI.events.onRunStatusChanged((rawPayload) => {
    const payload = rawPayload as {
      runId: string;
      sessionId: string;
      status: RunSummary['status'];
      stopReason?: string;
    };
    if (!isActiveSessionEvent(payload.sessionId)) {
      return;
    }
    const session = useSessionStore.getState();
    const current = session.currentRun;
    if (current?.runId === payload.runId) {
      session.setCurrentRun({
        ...current,
        status: payload.status,
        stopReason: payload.stopReason || current.stopReason,
        stoppedAt: ['cancelled', 'interrupted'].includes(payload.status) ? Date.now() : current.stoppedAt,
      });
    }
  });
}

export function subscribeProjectInputsChanged(electronAPI: ElectronAPI) {
  return electronAPI.events.onProjectInputsChanged((payload) => {
    useProjectStore.getState().updateProjectInputs(payload.projectId, payload.inputs);
  });
}

export function subscribeProjectInputsError(electronAPI: ElectronAPI, showNotice: EventBridgeOptions['showNotice'], t: EventBridgeOptions['t']) {
  return electronAPI.events.onProjectInputsError((payload) => {
    const title = t('project.inputs.reconcileFailed');
    useNotificationStore.getState().add({ type: 'error', title, message: `${t('project.inputs.reconcileRetry')} ${payload.error}` });
    if (useProjectStore.getState().currentProject?.projectId === payload.projectId) showNotice(title);
  });
}
