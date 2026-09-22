import type { ContextSnapshot } from '@shared/types/session';
import { useCallback, useEffect, useRef } from 'react';
import { mergeCapturesWithSnapshot } from '../../services/conversationTimeline';
import { useAppSettingsStore } from '../../stores/appSettingsStore';
import { useCaptureStore } from '../../stores/captureStore';
import { useEvidenceStore } from '../../stores/evidenceStore';
import { useProjectStore } from '../../stores/projectStore';
import { useSessionStore } from '../../stores/sessionStore';

import { createCaptureProjection, subscribeCaptureStatusChanged, subscribeDeviceStatusChanged } from './captureSubscriptions';
import { subscribeConversation, subscribeToolExecutionComplete } from './conversationSubscriptions';
import type { EventBridgeOptions } from './eventBridgeOptions';
import {
  subscribeAgentMessage,
  subscribeAgentStatusChanged,
  subscribeEvidenceEventAdded,
  subscribeProjectInputsChanged,
  subscribeProjectInputsError,
  subscribeRunStatusChanged,
  subscribeRunUsageChanged,
  subscribeTraceProjectionChanged,
} from './sessionSubscriptions';
import { subscribeAppThemeChanged, subscribeRuntimeLogAppended, subscribeShellCommands } from './shellSubscriptions';

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

export function useIpcEventBridge(options: EventBridgeOptions): void {
  const { syncCapturesFromSnapshot, showNotice, setSettingsModalOpen, setWindowMaximized, t } = options;

  const setSystemTheme = useAppSettingsStore((state) => state.setSystemTheme);
  const addActionEvent = useEvidenceStore((state) => state.addActionEvent);
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


    const unsubscribeRunUsageChanged = subscribeRunUsageChanged(electronAPI);
    const unsubscribeTraceProjectionChanged = subscribeTraceProjectionChanged(electronAPI);


    const captureProjection = createCaptureProjection(electronAPI, syncCapturesFromSnapshot);
    const { projectScopedContext, projectScopedOpenedCapture } = captureProjection;
    const unsubscribeContextChanged = electronAPI.events.onContextChanged(projectScopedContext);

    const conversation = subscribeConversation(electronAPI, showNotice, t);
    const unsubscribeToolExecutionComplete = subscribeToolExecutionComplete(electronAPI);
    const unsubscribeAgentMessage = subscribeAgentMessage(electronAPI);
    const unsubscribeAgentStatusChanged = subscribeAgentStatusChanged(electronAPI);
    const unsubscribeCaptureStatusChanged = subscribeCaptureStatusChanged(electronAPI, projectScopedContext);
    const unsubscribeEvidenceEventAdded = subscribeEvidenceEventAdded(electronAPI, addActionEvent);
    const unsubscribeRunStatusChanged = subscribeRunStatusChanged(electronAPI);
    const unsubscribeDeviceStatusChanged = subscribeDeviceStatusChanged(electronAPI);
    const unsubscribeProjectInputsChanged = subscribeProjectInputsChanged(electronAPI);
    const unsubscribeProjectInputsError = subscribeProjectInputsError(electronAPI, showNotice, t);
    const unsubscribeOpenedCaptureStateChanged = electronAPI.events.onOpenedCaptureStateChanged((event) => {
      projectScopedOpenedCapture(event);
    });
    const unsubscribeRuntimeLogAppended = subscribeRuntimeLogAppended(electronAPI);
    const unsubscribeAppThemeChanged = subscribeAppThemeChanged(electronAPI, setSystemTheme);

    captureProjection.hydrate();
    const unsubscribeShellCommands = subscribeShellCommands(electronAPI, { showNotice, t, setSettingsModalOpen, setWindowMaximized });

    return () => {
      conversation.disposeBatcher();
      unsubscribeRunUsageChanged();
      unsubscribeTraceProjectionChanged();
      unsubscribeContextChanged();
      unsubscribeToolExecutionComplete();
      unsubscribeAgentMessage();
      unsubscribeAgentStatusChanged();
      unsubscribeCaptureStatusChanged();
      unsubscribeEvidenceEventAdded();
      unsubscribeRunStatusChanged();
      unsubscribeDeviceStatusChanged();
      unsubscribeProjectInputsChanged();
      unsubscribeProjectInputsError();
      unsubscribeOpenedCaptureStateChanged();
      unsubscribeRuntimeLogAppended();
      unsubscribeAppThemeChanged();
      conversation.unsubscribe();
      unsubscribeShellCommands();
    };
  }, [
    activeSessionId,
    addActionEvent,
    setSettingsModalOpen,
    setSystemTheme,
    setWindowMaximized,
    showNotice,
    syncCapturesFromSnapshot,
    t,
  ]);
}
