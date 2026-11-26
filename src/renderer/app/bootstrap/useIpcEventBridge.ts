import { useCallback, useEffect } from 'react';
import { mergeCapturesWithSnapshot } from '../../services/conversationTimeline';
import { useAppSettingsStore } from '../../stores/appSettingsStore';
import { useCaptureStore } from '../../stores/captureStore';
import { useProjectStore } from '../../stores/projectStore';
import { useSessionStore } from '../../stores/sessionStore';

import {
  createCaptureProjection,
  subscribeCaptureStatusChanged,
  subscribeDeviceStatusChanged,
} from './captureSubscriptions';
import { subscribeConversation, subscribeToolExecutionComplete } from './conversationSubscriptions';
import {
  subscribeEvidenceEventAdded,
  subscribeProjectInputsChanged,
  subscribeProjectInputsError,
  subscribeRunStatusChanged,
  subscribeRunUsageChanged,
  subscribeSessionRecordChanged,
  subscribeTraceProjectionChanged,
} from './sessionSubscriptions';
import { subscribePermissionState } from './permissionSubscriptions';
import { subscribeAppThemeChanged, subscribeRuntimeLogAppended, subscribeShellCommands } from './shellSubscriptions';
import type { EventBridgeOptions } from './eventBridgeOptions';
import type { ContextSnapshot } from '@shared/types/session';

export function useSyncCapturesFromSnapshot() {
  return useCallback((snapshot: ContextSnapshot) => {
    if (!snapshot.captureDescriptors.length) {
      useCaptureStore.getState().setCaptures([]);
      return;
    }

    const captureStore = useCaptureStore.getState();
    if (useSessionStore.getState().currentRun) {
      captureStore.setCaptures(snapshot.captureDescriptors);
      return;
    }

    captureStore.setCaptures(mergeCapturesWithSnapshot(captureStore.captures, snapshot));
  }, []);
}

export function useIpcEventBridge(options: EventBridgeOptions): void {
  const { syncCapturesFromSnapshot, setSettingsModalOpen, setWindowMaximized, t } = options;

  const setSystemTheme = useAppSettingsStore((state) => state.setSystemTheme);
  const activeSessionId = useProjectStore((state) => state.currentSessionId);

  useEffect(() => {
    const electronAPI = window.electronAPI;

    const unsubscribePermissionState = subscribePermissionState(electronAPI);
    const unsubscribeSessionRecordChanged = subscribeSessionRecordChanged(electronAPI);
    const unsubscribeRunUsageChanged = subscribeRunUsageChanged(electronAPI);
    const unsubscribeTraceProjectionChanged = subscribeTraceProjectionChanged(electronAPI);

    const captureProjection = createCaptureProjection(electronAPI, syncCapturesFromSnapshot);
    const { projectScopedContext, projectScopedOpenedCapture } = captureProjection;
    const unsubscribeContextChanged = electronAPI.events.onContextChanged(projectScopedContext);

    const conversation = subscribeConversation(electronAPI);
    const unsubscribeToolExecutionComplete = subscribeToolExecutionComplete(electronAPI);
    const unsubscribeCaptureStatusChanged = subscribeCaptureStatusChanged(electronAPI, projectScopedContext);
    const unsubscribeEvidenceEventAdded = subscribeEvidenceEventAdded(electronAPI);
    const unsubscribeRunStatusChanged = subscribeRunStatusChanged(electronAPI);
    const unsubscribeDeviceStatusChanged = subscribeDeviceStatusChanged(electronAPI);
    const unsubscribeProjectInputsChanged = subscribeProjectInputsChanged(electronAPI);
    const unsubscribeProjectInputsError = subscribeProjectInputsError(electronAPI, t);
    const unsubscribeOpenedCaptureStateChanged = electronAPI.events.onOpenedCaptureStateChanged((event) => {
      projectScopedOpenedCapture(event);
    });
    const unsubscribeRuntimeLogAppended = subscribeRuntimeLogAppended(electronAPI);
    const unsubscribeAppThemeChanged = subscribeAppThemeChanged(electronAPI, setSystemTheme);

    captureProjection.hydrate();
    const unsubscribeShellCommands = subscribeShellCommands(electronAPI, {
      t,
      setSettingsModalOpen,
      setWindowMaximized,
    });

    return () => {
      unsubscribePermissionState();
      unsubscribeSessionRecordChanged();
      conversation.disposeBatcher();
      unsubscribeRunUsageChanged();
      unsubscribeTraceProjectionChanged();
      unsubscribeContextChanged();
      unsubscribeToolExecutionComplete();
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
  }, [activeSessionId, setSettingsModalOpen, setSystemTheme, setWindowMaximized, syncCapturesFromSnapshot, t]);
}
