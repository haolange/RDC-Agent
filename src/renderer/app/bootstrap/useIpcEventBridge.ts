import { useCallback, useEffect } from 'react';
import type { AgentState, AgentTimelineEntry } from '@shared/types/agent';
import type { ConversationStreamEvent } from '@shared/types/conversation';
import type { ToolTraceEntry } from '@shared/types/tool';
import type { ReplayDeviceStatusChangedPayload } from '@shared/types/device';
import type { RuntimeLogEntry } from '@shared/types/runtimeLog';
import type { ActionEvent } from '@shared/types/evidence';
import type { WorkflowState } from '@shared/types/workflow';
import type { RunSummary, ContextSnapshot } from '@shared/types/session';
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
import { useTerminalStore } from '../../stores/terminalStore';
import { useWorkflowStore } from '../../stores/workflowStore';
import { resetWorkbenchStores } from '../../stores/storesReset';

export function useSyncCapturesFromSnapshot() {
  return useCallback((snapshot: ContextSnapshot) => {
    if (!snapshot.captureDescriptors?.length) {
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

  useEffect(() => {
    const electronAPI = window.electronAPI;
    if (!electronAPI) return;

    const unsubscribeRunUsageChanged = electronAPI.events.onRunUsageChanged((summary) => {
      const { currentRun } = useSessionStore.getState();
      const isCurrentRun = currentRun?.runId === summary.runId;
      // Ask 模式：summary.runId 承载 sessionId，与 debug run 并列判断（run 结束后仍需更新）。
      const currentSession = useProjectStore.getState().currentSession;
      const isCurrentSession = currentSession?.sessionId === summary.runId;
      if (isCurrentRun || isCurrentSession) {
        useSessionStore.getState().setCurrentRunUsage(summary);
      }
    });

    const unsubscribeTraceProjectionChanged = electronAPI.events.onTraceProjectionChanged((payload) => {
      useWorkflowStore.getState().setTracePresentation(payload.presentation);
    });

    const unsubscribeContextChanged = electronAPI.events.onContextChanged((snapshot) => {
      useCaptureStore.getState().setContextSnapshot(snapshot);
      syncCapturesFromSnapshot(snapshot);
    });

    const handleConversationEvent = (event: ConversationStreamEvent) => {
      const conversation = useConversationStore.getState();
      if (event.type === 'run_linked') {
        conversation.patchAssistantMessageByTurnId(event.turnId, { runId: event.runId });
        return;
      }
      if (event.type === 'agent_event') {
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
      conversation.upsertConversationMessage(event.message);
    };

    electronAPI.conversation.onEvent(handleConversationEvent);

    const unsubscribeToolExecutionComplete = electronAPI.events.onToolExecutionComplete((rawTrace) => {
      const trace = rawTrace as ToolTraceEntry;
      const conversation = useConversationStore.getState();
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
        conversation.updateAssistantMessageByTurnId(trace.turnId, (message) => applyToolTraceToMessage(message, trace));
      }
    });

    /** 类型守卫：判断 IPC 入站对象是否符合 agent:message 的最小契约。 */
    const isAgentMessagePayload = (
      value: unknown,
    ): value is { id?: string; agentRole?: AgentTimelineEntry['agentRole']; content?: string } => {
      if (!value || typeof value !== 'object') return false;
      const obj = value as Record<string, unknown>;
      if (obj.id !== undefined && typeof obj.id !== 'string') return false;
      if (obj.content !== undefined && typeof obj.content !== 'string') return false;
      return true;
    };

    const unsubscribeAgentMessage = electronAPI.events.onAgentMessage((rawMsg) => {
      if (!isAgentMessagePayload(rawMsg)) {
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
      return typeof obj.agentId === 'string' && typeof obj.status === 'string';
    };

    const unsubscribeAgentStatusChanged = electronAPI.events.onAgentStatusChanged((rawState) => {
      if (isAgentStatePayload(rawState)) {
        useAgentStore.getState().updateAgentState(rawState);
      }
    });

    const unsubscribeCaptureStatusChanged = electronAPI.events.onCaptureStatusChanged(() => {
      electronAPI.context.get().then((snapshot) => {
        useCaptureStore.getState().setContextSnapshot(snapshot);
        syncCapturesFromSnapshot(snapshot);
      }).catch(() => undefined);
    });

    const unsubscribeEvidenceEventAdded = electronAPI.events.onEvidenceEventAdded((rawEvent) => {
      const event = rawEvent as ActionEvent;
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
        lastStage?: string;
        stopReason?: string;
      };
      const session = useSessionStore.getState();
      const current = session.currentRun;
      if (current?.runId === payload.runId) {
        session.setCurrentRun({
          ...current,
          status: payload.status,
          lastStage: payload.lastStage || current.lastStage,
          stopReason: payload.stopReason || current.stopReason,
          stoppedAt: ['cancelled', 'interrupted'].includes(payload.status) ? Date.now() : current.stoppedAt,
        });
        if (!['planning', 'awaiting_input', 'awaiting_approval', 'queued', 'running', 'stopping'].includes(payload.status)) {
          session.markRunUsageStale();
        }
      }
    });

    const unsubscribeDeviceStatusChanged = electronAPI.events.onDeviceStatusChanged((payload) => {
      useDeviceStore.getState().applyStatusPayload(payload as ReplayDeviceStatusChangedPayload);
    });

    const unsubscribeProjectInputsChanged = electronAPI.events.onProjectInputsChanged((payload) => {
      useProjectStore.getState().updateProjectInputs(payload.projectId, payload.inputs);
    });

    const unsubscribeOpenedCaptureStateChanged = electronAPI.events.onOpenedCaptureStateChanged((state) => {
      useCaptureStore.getState().setOpenedCapture(state);
    });

    const unsubscribeRuntimeLogAppended = electronAPI.events.onRuntimeLogAppended((entry) => {
      useTerminalStore.getState().appendEntry(entry as RuntimeLogEntry);
    });

    const unsubscribeAppThemeChanged = electronAPI.events.onAppThemeChanged((theme) => {
      setSystemTheme(theme);
    });

    void useDeviceStore.getState().loadDevices();
    void electronAPI.capture.getOpenedState()
      .then((state) => useCaptureStore.getState().setOpenedCapture(state))
      .catch(() => undefined);
    void electronAPI.context.get()
      .then((snapshot) => useCaptureStore.getState().setContextSnapshot(snapshot))
      .catch(() => undefined);

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
  }, [addActionEvent, setReasoningSummaries, setSettingsModalOpen, setSystemTheme, setWindowMaximized, setWorkflowState, showNotice, syncCapturesFromSnapshot, t]);
}
