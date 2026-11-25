import type { EventSubscriptionApi } from '../types/electron-api';
import type { RuntimePermissionState } from '../types/runtimePermission';
import type { RuntimeLogEntry } from '../types/runtimeLog';
import type { SettingsChangedPayload } from '../types/settings';
import type {
  ContextSnapshot,
  OpenedCaptureState,
  ProjectInputRecord,
  RunContextUsageSummary,
  SessionScopedPayload,
} from '../types/session';
import type { TraceProjectionChangedPayload } from '../types/agenticTrace';
import type { RendererApiTransport } from './transport';

export function createEventSubscriptionApi(transport: RendererApiTransport): EventSubscriptionApi {
  return {
    onPlanReviewChanged: (callback) => transport.subscribe('plan:reviewChanged',
      payload => callback(payload as Parameters<typeof callback>[0])),
    onSessionRecordChanged: (callback) => transport.subscribe('session:recordChanged',
      payload => callback(payload as Parameters<typeof callback>[0])),
    onDelegationTraceChanged: (callback) => (
      transport.subscribe('conversation:delegationChanged', (payload) => (
        callback(payload as { sessionId: string; parentToolCallId: string; revision: number })
      ))
    ),
    onRunStatusChanged: (callback) => (
      transport.subscribe('workflow:runStatusChanged', (data) => callback(data as Parameters<typeof callback>[0]))
    ),
    onRunUsageChanged: (callback) => (
      transport.subscribe('workflow:runUsageChanged', (summary) => (
        callback(summary as SessionScopedPayload<RunContextUsageSummary>)
      ))
    ),
    onTraceProjectionChanged: (callback) => (
      transport.subscribe('trace:projectionChanged', (payload) => (
        callback(payload as TraceProjectionChangedPayload)
      ))
    ),
    onProbeBatchChanged: callback => transport.subscribe('llm:probeBatchChanged',
      payload => callback(payload as Parameters<typeof callback>[0])),
    onKnowledgeProgress: callback => transport.subscribe('knowledge:progress',
      payload => callback(payload as Parameters<typeof callback>[0])),
    onEffectiveCatalogChanged: (callback) => (
      transport.subscribe('llm:effectiveCatalogChanged', (change) => (
        callback(change as Parameters<typeof callback>[0])
      ))
    ),
    onToolExecutionComplete: (callback) => (
      transport.subscribe('tool:executionComplete', (trace) => callback(trace))
    ),
    onEvidenceEventAdded: (callback) => (
      transport.subscribe('evidence:eventAdded', (event) => callback(event as Parameters<typeof callback>[0]))
    ),
    onDeviceStatusChanged: (callback) => (
      transport.subscribe('device:statusChanged', (status) => (
        callback(status as Parameters<typeof callback>[0])
      ))
    ),
    onCaptureStatusChanged: (callback) => (
      transport.subscribe('capture:statusChanged', (status) => (
        callback(status as SessionScopedPayload<unknown>)
      ))
    ),
    onContextChanged: (callback) => (
      transport.subscribe('context:changed', (snapshot) => (
        callback(snapshot as SessionScopedPayload<ContextSnapshot | null>)
      ))
    ),
    onProjectInputsChanged: (callback) => (
      transport.subscribe('project:inputsChanged', (payload) => (
        callback(payload as { projectId: string; inputs: ProjectInputRecord[] })
      ))
    ),
    onProjectInputsError: (callback) => transport.subscribe('project:inputsError',
      payload => callback(payload as { projectId: string; error: string })),
    onCaptureReplayChanged: (callback) => transport.subscribe('capture:replayChanged', payload => callback(payload as import('../types/captureReplay').CaptureReplayState)),
    onOpenedCaptureStateChanged: (callback) => (
      transport.subscribe('capture:openedStateChanged', (payload) => (
        callback(payload as SessionScopedPayload<OpenedCaptureState | null>)
      ))
    ),
    onPermissionStateChanged: (callback) => (
      transport.subscribe('runtime:permissionStateChanged', (state) => callback(state as RuntimePermissionState))
    ),
    onRuntimeLogAppended: (callback) => (
      transport.subscribe('runtime:logAppended', (entry) => callback(entry as RuntimeLogEntry))
    ),
    onSettingsChanged: (callback) => (
      transport.subscribe('settings:changed', (change) => callback(change as SettingsChangedPayload))
    ),
    onAppThemeChanged: (callback) => (
      transport.subscribe('app:themeChanged', (theme) => callback(theme as Parameters<typeof callback>[0]))
    ),
    removeAllListeners: (channel) => {
      const candidate = channel as Parameters<RendererApiTransport['removeAllListeners']>[0];
      transport.removeAllListeners(candidate);
    },
  };
}
