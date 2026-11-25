import {
  applyActionEventToMessage,
  mapActionEventToTimelineEntry
} from '../../services/conversationTimeline';
import { useAgentStore } from '../../stores/agentStore';
import { acceptsContextUsage } from '../../stores/contextUsageProjectionModel';
import { useConversationStore } from '../../stores/conversationStore';
import { notify } from '../../stores/notificationStore';
import { useProjectStore } from '../../stores/projectStore';
import { acceptSessionSnapshot } from '../../stores/sessionRecordStore';
import { isActiveSessionEvent, isActiveSessionScope } from '../../stores/sessionEventGate';
import { useSessionProjectionStore } from '../../stores/sessionProjectionStore';
import { useSessionStore } from '../../stores/sessionStore';
import { useWorkflowStore } from '../../stores/workflowStore';
import type { RunSummary } from '@shared/types/session';
import type { ActionEvent } from '@shared/types/evidence';
import type { AgentState } from '@shared/types/agent';

import type { ElectronAPI } from '@shared/types/electron';
import type { EventBridgeOptions } from './eventBridgeOptions';
const projection = () => useSessionProjectionStore.getState();

/** 类型守卫：判断 IPC 入站对象是否符合 AgentState 的最小契约。 */
const isAgentStatePayload = (value: unknown): value is AgentState => {
  if (!value || typeof value !== 'object') return false;
  const obj = value as Record<string, unknown>;
  return typeof obj.agentId === 'string'
    && typeof obj.status === 'string'
    && typeof obj.sessionId === 'string'
    && obj.sessionId.trim().length > 0;
};

/** Every session write main makes. The record store is keyed by session and keeps the newest revision, so no gate applies. */
export function subscribeSessionRecordChanged(electronAPI: ElectronAPI) {
  return electronAPI.events.onSessionRecordChanged((snapshot) => acceptSessionSnapshot(snapshot));
}

export function subscribeRunUsageChanged(electronAPI: ElectronAPI) {
  return electronAPI.events.onRunUsageChanged((event) => {
    if (useProjectStore.getState().currentSessionId !== event.sessionId) {
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

export function subscribeProjectInputsError(electronAPI: ElectronAPI, t: EventBridgeOptions['t']) {
  return electronAPI.events.onProjectInputsError((payload) => {
    console.error('[project-inputs] reconcile failed', payload.error);
    notify.error(t('project.inputs.reconcileFailed'), t('project.inputs.reconcileRetry'));
  });
}
