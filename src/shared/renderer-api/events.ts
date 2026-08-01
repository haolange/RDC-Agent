import type { EventSubscriptionApi } from '../types/electron-api';
import type { RuntimeLogEntry } from '../types/runtimeLog';
import type {
  ContextSnapshot,
  OpenedCaptureState,
  ProjectInputRecord,
  RunContextUsageSummary,
  SessionScopedPayload,
} from '../types/session';
import type { TerminalDataEvent, TerminalExitEvent, TerminalTabRecord } from '../types/terminal';
import type { TraceProjectionChangedPayload } from '../types/agenticTrace';
import { RENDERER_EVENT_CHANNEL as EVENT } from './channels';
import type { RendererApiTransport } from './transport';

export function createEventSubscriptionApi(transport: RendererApiTransport): EventSubscriptionApi {
  return {
    onWorkflowStateChanged: (callback) => (
      transport.subscribe(EVENT.workflow.stateChanged, (state) => callback(state as Parameters<typeof callback>[0]))
    ),
    onWorkflowStageChanged: (callback) => (
      transport.subscribe(EVENT.workflow.stageChanged, (data) => callback(data as Parameters<typeof callback>[0]))
    ),
    onRunStatusChanged: (callback) => (
      transport.subscribe(EVENT.workflow.runStatusChanged, (data) => callback(data as Parameters<typeof callback>[0]))
    ),
    onRunUsageChanged: (callback) => (
      transport.subscribe(EVENT.workflow.runUsageChanged, (summary) => (
        callback(summary as SessionScopedPayload<RunContextUsageSummary>)
      ))
    ),
    onTraceProjectionChanged: (callback) => (
      transport.subscribe(EVENT.workflow.traceProjectionChanged, (payload) => (
        callback(payload as TraceProjectionChangedPayload)
      ))
    ),
    onEffectiveCatalogChanged: (callback) => (
      transport.subscribe(EVENT.llm.effectiveCatalogChanged, (snapshot) => (
        callback(snapshot as Parameters<typeof callback>[0])
      ))
    ),
    onAgentMessage: (callback) => transport.subscribe(EVENT.agent.message, (message) => callback(message)),
    onAgentStatusChanged: (callback) => (
      transport.subscribe(EVENT.agent.statusChanged, (state) => callback(state as Parameters<typeof callback>[0]))
    ),
    onToolExecutionComplete: (callback) => (
      transport.subscribe(EVENT.tools.executionComplete, (trace) => callback(trace))
    ),
    onEvidenceEventAdded: (callback) => (
      transport.subscribe(EVENT.tools.evidenceAdded, (event) => callback(event as Parameters<typeof callback>[0]))
    ),
    onDeviceStatusChanged: (callback) => (
      transport.subscribe(EVENT.workbench.deviceStatusChanged, (status) => (
        callback(status as Parameters<typeof callback>[0])
      ))
    ),
    onCaptureStatusChanged: (callback) => (
      transport.subscribe(EVENT.workbench.captureStatusChanged, (status) => (
        callback(status as SessionScopedPayload<unknown>)
      ))
    ),
    onContextChanged: (callback) => (
      transport.subscribe(EVENT.workbench.contextChanged, (snapshot) => (
        callback(snapshot as SessionScopedPayload<ContextSnapshot | null>)
      ))
    ),
    onProjectInputsChanged: (callback) => (
      transport.subscribe(EVENT.workbench.projectInputsChanged, (payload) => (
        callback(payload as { projectId: string; inputs: ProjectInputRecord[] })
      ))
    ),
    onOpenedCaptureStateChanged: (callback) => (
      transport.subscribe(EVENT.workbench.openedCaptureStateChanged, (payload) => (
        callback(payload as SessionScopedPayload<OpenedCaptureState | null>)
      ))
    ),
    onRuntimeLogAppended: (callback) => (
      transport.subscribe(EVENT.runtime.logAppended, (entry) => callback(entry as RuntimeLogEntry))
    ),
    onTerminalData: (callback) => (
      transport.subscribe(EVENT.runtime.terminalData, (event) => callback(event as TerminalDataEvent))
    ),
    onTerminalExit: (callback) => (
      transport.subscribe(EVENT.runtime.terminalExit, (event) => callback(event as TerminalExitEvent))
    ),
    onTerminalTabsChanged: (callback) => (
      transport.subscribe(EVENT.runtime.terminalTabsChanged, (payload) => (
        callback(payload as { tabs: TerminalTabRecord[] })
      ))
    ),
    onAppThemeChanged: (callback) => (
      transport.subscribe(EVENT.shell.themeChanged, (theme) => callback(theme as Parameters<typeof callback>[0]))
    ),
    removeAllListeners: (channel) => {
      const candidate = channel as Parameters<RendererApiTransport['removeAllListeners']>[0];
      transport.removeAllListeners(candidate);
    },
  };
}
