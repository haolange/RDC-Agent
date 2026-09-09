import { useCallback, useEffect, useRef } from 'react';
import type { AgentState, AgentTimelineEntry } from '@shared/types/agent';
import type { ConversationStreamEvent } from '@shared/types/conversation';
import type { ToolTraceEntry } from '@shared/types/tool';
import type { ReplayDeviceStatusChangedPayload } from '@shared/types/device';
import type { RuntimeLogEntry } from '@shared/types/runtimeLog';
import type { ActionEvent } from '@shared/types/evidence';
import type { WorkflowState } from '@shared/types/workflow';
import type { RunSummary, ContextSnapshot, SessionScopedPayload } from '@shared/types/session';
import type { TranslationKey } from '../../i18n';
import {
  applyActionEventToMessage,
  applyToolTraceToMessage,
  hydrateMessagesWithActionEvents,
  mapActionEventToTimelineEntry,
  mergeCapturesWithSnapshot,
} from '../../services/conversationTimeline';
import { useAgentStore } from '../../stores/agentStore';
import { useAppSettingsStore } from '../../stores/appSettingsStore';
import { useCaptureStore } from '../../stores/captureStore';
import { useConversationStore } from '../../stores/conversationStore';
import { useDeviceStore } from '../../stores/deviceStore';
import { useEvidenceStore } from '../../stores/evidenceStore';
import { useProjectStore } from '../../stores/projectStore';
import { useSessionStore } from '../../stores/sessionStore';
import { useSessionProjectionStore } from '../../stores/sessionProjectionStore';
import { useLayoutStore } from '../../stores/layoutStore';
import { useTerminalStore } from '../../stores/terminalStore';
import { useWorkflowStore } from '../../stores/workflowStore';
import { resetWorkbenchStores } from '../storesReset';
import { acceptsContextUsage } from '../../stores/contextUsageProjectionModel';
import { createConversationEventBatcher } from './conversationEventBatcher';
import { isActiveSessionEvent, isActiveSessionScope } from '../../stores/sessionEventGate';

export function useSyncCapturesFromSnapshot() {
  return useCallback((snapshot: ContextSnapshot) => {
    if (!snapshot.captureDescriptors?.length) {
      useCaptureStore.getState().setCaptures([]);
      return;
    }

    const captureStore = useCaptureStore.getState();
    if (useSessionStore.getState().currentRun) {
      captureStore.setCaptures(snapshot.captureDescriptors ?? []);
      return;
    }

    captureStore.setCaptures(
      mergeCapturesWithSnapshot(captureStore.captures, snapshot),
    );
  }, []);
}

function resolveMessageSessionId(message: { sessionId?: string | null }): string | null {
  return message.sessionId ?? null;
}

export function useIpcEventBridge(options: {
  syncCapturesFromSnapshot: (snapshot: ContextSnapshot) => void;
  showNotice: (message: string) => void;
  setSettingsModalOpen: (open: boolean) => void;
  setWindowMaximized: (maximized: boolean) => void;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
}): void {
  const { syncCapturesFromSnapshot, showNotice, setSettingsModalOpen, setWindowMaximized, t } = options;

  const setSystemTheme = useAppSettingsStore((state) => state.setSystemTheme);
  const addActionEvent = useEvidenceStore((state) => state.addActionEvent);
  const setWorkflowState = useWorkflowStore((state) => state.setWorkflowState);
  const setReasoningSummaries = useConversationStore((state) => state.setReasoningSummaries);
  const activeSessionId = useProjectStore((state) => state.currentSession?.sessionId ?? null);
  const handoffNotice = useProjectStore((state) => state.currentSession?.handoffNotice);
  const shownHandoffNotices = useRef(new Set<string>());
  useEffect(() => {
    if (!activeSessionId || !handoffNotice) return;
    const key = activeSessionId + ':' + handoffNotice;
    if (shownHandoffNotices.current.has(key)) return;
    shownHandoffNotices.current.add(key);
    showNotice(handoffNotice);
  }, [activeSessionId, handoffNotice, showNotice]);

  useEffect(() => {
    const electronAPI = window.electronAPI;
    if (!electronAPI) return;

    const projection = () => useSessionProjectionStore.getState();

    const unsubscribeRunUsageChanged = electronAPI.events.onRunUsageChanged((event) => {
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

    const unsubscribeTraceProjectionChanged = electronAPI.events.onTraceProjectionChanged((payload) => {
      if (!isActiveSessionScope(payload)) {
        projection().projectTrace(payload.sessionId, payload.presentation);
        return;
      }
      useWorkflowStore.getState().setTracePresentation(payload.presentation);
    });


    const projectScopedContext = (event: SessionScopedPayload<ContextSnapshot | null>) => {
      projection().projectContextSnapshot(event.sessionId, event.payload);
      if (!isActiveSessionScope(event)) return;
      useCaptureStore.getState().setContextSnapshot(event.payload);
      if (event.payload) syncCapturesFromSnapshot(event.payload);
      else useCaptureStore.getState().setCaptures([]);
    };

    const projectScopedOpenedCapture = (event: SessionScopedPayload<ReturnType<typeof useCaptureStore.getState>['openedCapture']>) => {
      projection().projectOpenedCapture(event.sessionId, event.payload);
      if (isActiveSessionScope(event)) useCaptureStore.getState().setOpenedCapture(event.payload);
    };

    const unsubscribeContextChanged = electronAPI.events.onContextChanged(projectScopedContext);

    const conversationEventBatcher = createConversationEventBatcher({
      applyMessage: (event) => {
        const sessionId = resolveMessageSessionId(event.message) ?? event.sessionId;
        const terminal = event.type === 'message_completed' || event.type === 'message_errored';
        if (!isActiveSessionEvent(sessionId)) {
          if (sessionId) {
            projection().projectConversationMessage(sessionId, event.message);
            if (terminal) {
              projection().projectConversationTerminal(sessionId, event.turnId, event.type === 'message_completed');
            }
          }
          return;
        }
        const conversation = useConversationStore.getState();
        conversation.upsertConversationMessage(event.message);
        if (terminal) {
          projection().projectConversationTerminal(sessionId, event.turnId, event.type === 'message_completed');
          useSessionStore.getState().markConversationTurnTerminal(
            event.turnId,
            event.type === 'message_completed',
          );
        }
      },
    });

    const handleConversationEvent = (event: ConversationStreamEvent) => {
      if (!isActiveSessionEvent(event.sessionId)) {
        if (event.type === 'message_patched' || event.type === 'message_completed' || event.type === 'message_errored') {
          projection().projectConversationMessage(event.sessionId, event.message);
          if (event.type === 'message_completed' || event.type === 'message_errored') {
            projection().projectConversationTerminal(event.sessionId, event.turnId, event.type === 'message_completed');
          }
        }
        return;
      }

      const conversation = useConversationStore.getState();
      if (event.type === 'run_linked') {
        conversation.patchAssistantMessageByTurnId(event.turnId, { runId: event.runId });
        return;
      }
      if (event.type === 'agent_event') {
        if (
          event.event.type === 'handoff.requested'
          || event.event.type === 'handoff.consumed'
          || event.event.type === 'handoff.cancelled'
        ) {
          const toAgentId = String(
            event.event.payload.toAgentId
            ?? event.event.payload.toProfile
            ?? '',
          ).trim();
          if (
            (event.event.type === 'handoff.requested' || event.event.type === 'handoff.consumed')
            && toAgentId
          ) {
            useLayoutStore.getState().setSelectedAgentId(toAgentId);
          }
          if (
            event.event.type === 'handoff.cancelled'
            && event.event.payload.cancelReason === 'restart_degrade'
          ) {
            showNotice(t('chat.handoffRestartDegraded'));
          }
          return;
        }
        if (event.event.type === 'diagnostic') {
          conversation.addTimelineEntry({
            id: event.event.id,
            type: 'agent',
            agentRole: event.event.agentId,
            content: String(event.event.payload.message ?? ''),
            timestamp: event.event.timestamp,
          });
        }
        return;
      }
      conversationEventBatcher.handle(event);
    };

    electronAPI.conversation.onEvent(handleConversationEvent);

    const unsubscribeToolExecutionComplete = electronAPI.events.onToolExecutionComplete((rawTrace) => {
      const trace = rawTrace as ToolTraceEntry;
      const conversation = useConversationStore.getState();
      const message = trace.turnId
        ? conversation.allConversationMessages.find(
          (entry) => entry.turnId === trace.turnId && entry.role === 'assistant',
        )
        : undefined;
      const sessionId = message?.sessionId ?? null;
      if (sessionId && !isActiveSessionEvent(sessionId)) {
        // Background tool rows stay in the owning session projection via message patches.
        return;
      }
      // Without a resolvable session, only apply when the turn exists on the active transcript.
      if (!sessionId && trace.turnId) {
        const onActive = conversation.conversationMessages.some((entry) => entry.turnId === trace.turnId);
        if (!onActive) return;
      }

      const lastEntry = conversation.timeline[conversation.timeline.length - 1];
      if (lastEntry?.id !== trace.traceId) {
        conversation.addTimelineEntry({
          id: trace.traceId,
          type: 'tool_call',
          content: trace.toolName,
          toolTrace: trace,
          timestamp: trace.timestamp,
        });
      }
      if (trace.turnId) {
        conversation.updateAssistantMessageByTurnId(trace.turnId, (entry) => applyToolTraceToMessage(entry, trace));
      }
    });

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

    const unsubscribeAgentMessage = electronAPI.events.onAgentMessage((rawMsg) => {
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

    /** 类型守卫：判断 IPC 入站对象是否符合 AgentState 的最小契约。 */
    const isAgentStatePayload = (value: unknown): value is AgentState => {
      if (!value || typeof value !== 'object') return false;
      const obj = value as Record<string, unknown>;
      return typeof obj.agentId === 'string'
        && typeof obj.status === 'string'
        && typeof obj.sessionId === 'string'
        && obj.sessionId.trim().length > 0;
    };

    const unsubscribeAgentStatusChanged = electronAPI.events.onAgentStatusChanged((rawState) => {
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

    const unsubscribeCaptureStatusChanged = electronAPI.events.onCaptureStatusChanged((event) => {
      const scoped = event as SessionScopedPayload<unknown>;
      if (!isActiveSessionScope(scoped)) return;
      electronAPI.context.get({ projectId: scoped.projectId, sessionId: scoped.sessionId }).then((snapshot) => {
        const payload: SessionScopedPayload<ContextSnapshot | null> = { ...scoped, payload: snapshot };
        projectScopedContext(payload);
      }).catch(() => undefined);
    });

    const unsubscribeEvidenceEventAdded = electronAPI.events.onEvidenceEventAdded((rawEvent) => {
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

    const unsubscribeWorkflowStateChanged = electronAPI.events.onWorkflowStateChanged((rawState) => {
      const state = rawState as WorkflowState;
      if (!isActiveSessionEvent(state.sessionId)) {
        projection().projectWorkflow(state.sessionId, state);
        return;
      }
      setWorkflowState(state);
      setReasoningSummaries(state.reasoningSummaries ?? []);
      const currentProject = useProjectStore.getState().currentProject;
      const currentSession = useProjectStore.getState().currentSession;

      if (currentProject) {
        electronAPI.session.list(currentProject.projectId)
          .then((result) => useProjectStore.getState().setSessions(result.sessions ?? []))
          .catch(() => undefined);
      }

      if (currentSession) {
        electronAPI.run.list(currentSession.sessionId)
          .then((result) => {
            useSessionStore.getState().setRuns(result.runs ?? []);
            const targetRunId = state.runId || useSessionStore.getState().currentRun?.runId;
            const activeRun = result.runs?.find((run) => run.runId === targetRunId)
              ?? result.runs?.[0]
              ?? null;
            if (activeRun) {
              useSessionStore.getState().setCurrentRun(activeRun);
              useCaptureStore.getState().setCaptures(activeRun.captures ?? []);
            }
          })
          .catch(() => undefined);

        electronAPI.evidence.getChain()
          .then((result) => {
            if (!isActiveSessionEvent(currentSession.sessionId)) return;
            useEvidenceStore.getState().setActionEvents(result.events ?? []);
            const timeline = (result.events ?? [])
              .map((event) => mapActionEventToTimelineEntry(event as ActionEvent))
              .filter((entry): entry is AgentTimelineEntry => entry !== null);
            useConversationStore.getState().setTimeline(timeline);
            useConversationStore.getState().setConversationMessages(
              hydrateMessagesWithActionEvents(
                useConversationStore.getState().conversationMessages,
                (result.events ?? []) as ActionEvent[],
              ),
            );
          })
          .catch(() => undefined);
      }
    });

    const unsubscribeRunStatusChanged = electronAPI.events.onRunStatusChanged((rawPayload) => {
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

    const unsubscribeDeviceStatusChanged = electronAPI.events.onDeviceStatusChanged((payload) => {
      useDeviceStore.getState().applyStatusPayload(payload as ReplayDeviceStatusChangedPayload);
    });

    const unsubscribeProjectInputsChanged = electronAPI.events.onProjectInputsChanged((payload) => {
      useProjectStore.getState().updateProjectInputs(payload.projectId, payload.inputs);
    });

    const unsubscribeOpenedCaptureStateChanged = electronAPI.events.onOpenedCaptureStateChanged((event) => {
      projectScopedOpenedCapture(event);
    });

    const unsubscribeRuntimeLogAppended = electronAPI.events.onRuntimeLogAppended((entry) => {
      useTerminalStore.getState().appendEntry(entry as RuntimeLogEntry);
    });

    const unsubscribeAppThemeChanged = electronAPI.events.onAppThemeChanged((theme) => {
      setSystemTheme(theme);
    });

    void useDeviceStore.getState().loadDevices();
    const initialProject = useProjectStore.getState().currentProject;
    const initialSession = useProjectStore.getState().currentSession;
    if (initialProject && initialSession) {
      const scope = { projectId: initialProject.projectId, sessionId: initialSession.sessionId };
      void electronAPI.capture.getOpenedState(scope)
        .then((payload) => projectScopedOpenedCapture({ ...scope, payload }))
        .catch(() => undefined);
      void electronAPI.context.get(scope)
        .then((payload) => projectScopedContext({ ...scope, payload }))
        .catch(() => undefined);
    }

    const handleFileOpen = (paths: unknown) => {
      if (!Array.isArray(paths) || paths.length === 0) return;
      showNotice(t('app.notice.filesReceived', { count: paths.length }));
    };
    const handleCaseNew = () => {
      resetWorkbenchStores();
      showNotice(t('app.notice.newWorkspace'));
    };
    const handleSettingsOpen = () => {
      setSettingsModalOpen(true);
    };
    const handleWindowStateChange = (isMaximized: unknown) => {
      setWindowMaximized(Boolean(isMaximized));
    };

    electronAPI.on('file:open', handleFileOpen);
    electronAPI.on('case:new', handleCaseNew);
    electronAPI.on('settings:open', handleSettingsOpen);
    electronAPI.on('window:maximized-changed', handleWindowStateChange);

    return () => {
      conversationEventBatcher.dispose();
      unsubscribeRunUsageChanged();
      unsubscribeTraceProjectionChanged();
      unsubscribeContextChanged();
      unsubscribeToolExecutionComplete();
      unsubscribeAgentMessage();
      unsubscribeAgentStatusChanged();
      unsubscribeCaptureStatusChanged();
      unsubscribeEvidenceEventAdded();
      unsubscribeWorkflowStateChanged();
      unsubscribeRunStatusChanged();
      unsubscribeDeviceStatusChanged();
      unsubscribeProjectInputsChanged();
      unsubscribeOpenedCaptureStateChanged();
      unsubscribeRuntimeLogAppended();
      unsubscribeAppThemeChanged();
      electronAPI.conversation.offEvent(handleConversationEvent);
      electronAPI.off('file:open', handleFileOpen);
      electronAPI.off('case:new', handleCaseNew);
      electronAPI.off('settings:open', handleSettingsOpen);
      electronAPI.off('window:maximized-changed', handleWindowStateChange);
    };
  }, [
    activeSessionId,
    addActionEvent,
    setReasoningSummaries,
    setSettingsModalOpen,
    setSystemTheme,
    setWindowMaximized,
    setWorkflowState,
    showNotice,
    syncCapturesFromSnapshot,
    t,
  ]);
}
