import type { EventSubscriptionApi } from '@shared/types/electron-api';
import type { RuntimeLogEntry } from '@shared/types/runtimeLog';
import type { RunContextUsageSummary, OpenedCaptureState, ProjectInputRecord } from '@shared/types/session';
import type { TerminalDataEvent, TerminalExitEvent, TerminalTabRecord } from '@shared/types/terminal';
import { removeAllTrackedListeners, registerTrackedListener } from './listeners';

export const createEventSubscriptionApi = (): EventSubscriptionApi => ({
  onWorkflowStateChanged: (callback): (() => void) =>
    registerTrackedListener('workflow:stateChanged', (state) => (callback as (value: unknown) => void)(state)),
  onWorkflowStageChanged: (callback): (() => void) =>
    registerTrackedListener('workflow:stageChanged', (data) => (callback as (value: unknown) => void)(data)),
  onRunStatusChanged: (callback): (() => void) =>
    registerTrackedListener('workflow:runStatusChanged', (data) => (callback as (value: unknown) => void)(data)),
  onRunUsageChanged: (callback): (() => void) =>
    registerTrackedListener('workflow:runUsageChanged', (summary) => callback(summary as RunContextUsageSummary)),
  onAgentMessage: (callback): (() => void) => registerTrackedListener('agent:message', (msg) => callback(msg)),
  onAgentStatusChanged: (callback): (() => void) =>
    registerTrackedListener('agent:statusChanged', (state) => (callback as (value: unknown) => void)(state)),
  onToolExecutionComplete: (callback): (() => void) =>
    registerTrackedListener('tool:executionComplete', (trace) => callback(trace)),
  onEvidenceEventAdded: (callback): (() => void) =>
    registerTrackedListener('evidence:eventAdded', (event) => (callback as (value: unknown) => void)(event)),
  onDeviceStatusChanged: (callback): (() => void) =>
    registerTrackedListener('device:statusChanged', (status) => (callback as (value: unknown) => void)(status)),
  onCaptureStatusChanged: (callback): (() => void) =>
    registerTrackedListener('capture:statusChanged', (status) => callback(status)),
  onContextChanged: (callback): (() => void) =>
    registerTrackedListener('context:changed', (snapshot) => (callback as (value: unknown) => void)(snapshot)),
  onProjectInputsChanged: (callback): (() => void) =>
    registerTrackedListener('project:inputsChanged', (payload) =>
      callback(payload as { projectId: string; inputs: ProjectInputRecord[] }),
    ),
  onOpenedCaptureStateChanged: (callback): (() => void) =>
    registerTrackedListener('capture:openedStateChanged', (payload) => callback(payload as OpenedCaptureState | null)),
  onRuntimeLogAppended: (callback): (() => void) =>
    registerTrackedListener('runtime:logAppended', (payload) => callback(payload as RuntimeLogEntry)),
  onTerminalData: (callback): (() => void) =>
    registerTrackedListener('terminal:data', (payload) => callback(payload as TerminalDataEvent)),
  onTerminalExit: (callback): (() => void) =>
    registerTrackedListener('terminal:exit', (payload) => callback(payload as TerminalExitEvent)),
  onTerminalTabsChanged: (callback): (() => void) =>
    registerTrackedListener('terminal:tabsChanged', (payload) => callback(payload as { tabs: TerminalTabRecord[] })),
  onAppThemeChanged: (callback): (() => void) =>
    registerTrackedListener('app:themeChanged', (theme) => callback(theme as 'dark' | 'light')),
  removeAllListeners: (channel): void => {
    removeAllTrackedListeners(channel);
  },
});
