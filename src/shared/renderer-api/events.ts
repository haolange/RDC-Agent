import { isRendererEventChannel } from './channels';
import type { EventSubscriptionApi } from '../types/electron-api';
import type { RendererEvents } from './rendererEvents';

export function createEventSubscriptionApi(events: RendererEvents): EventSubscriptionApi {
  return {
    onPlanReviewChanged: (callback) => events.subscribe('plan:reviewChanged', callback),
    onSessionRecordChanged: (callback) => events.subscribe('session:recordChanged', callback),
    onDelegationTraceChanged: (callback) => events.subscribe('conversation:delegationChanged', callback),
    onRunStatusChanged: (callback) => events.subscribe('workflow:runStatusChanged', callback),
    onRunUsageChanged: (callback) => events.subscribe('workflow:runUsageChanged', callback),
    onTraceProjectionChanged: (callback) => events.subscribe('trace:projectionChanged', callback),
    onProbeBatchChanged: (callback) => events.subscribe('llm:probeBatchChanged', callback),
    onKnowledgeProgress: (callback) => events.subscribe('knowledge:progress', callback),
    onEffectiveCatalogChanged: (callback) => events.subscribe('llm:effectiveCatalogChanged', callback),
    onToolExecutionComplete: (callback) => events.subscribe('tool:executionComplete', callback),
    onEvidenceEventAdded: (callback) => events.subscribe('evidence:eventAdded', callback),
    onDeviceStatusChanged: (callback) => events.subscribe('device:statusChanged', callback),
    onCaptureStatusChanged: (callback) => events.subscribe('capture:statusChanged', callback),
    onContextChanged: (callback) => events.subscribe('context:changed', callback),
    onProjectInputsChanged: (callback) => events.subscribe('project:inputsChanged', callback),
    onProjectInputsError: (callback) => events.subscribe('project:inputsError', callback),
    onCaptureReplayChanged: (callback) => events.subscribe('capture:replayChanged', callback),
    onOpenedCaptureStateChanged: (callback) => events.subscribe('capture:openedStateChanged', callback),
    onPermissionStateChanged: (callback) => events.subscribe('runtime:permissionStateChanged', callback),
    onRuntimeLogAppended: (callback) => events.subscribe('runtime:logAppended', callback),
    onSettingsChanged: (callback) => events.subscribe('settings:changed', callback),
    onAppThemeChanged: (callback) => events.subscribe('app:themeChanged', callback),
    removeAllListeners: (channel) => {
      if (isRendererEventChannel(channel)) events.removeAll(channel);
    },
  };
}
