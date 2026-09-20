import type { ActionEvent } from '@shared/types/evidence';
import type { RunSummary } from '@shared/types/session';
import type { RightPanelViewModel } from '@shared/types/trace';
import { createSessionTaskStore } from '../agent-runtime/tasks/sessionTaskStore';
import { TaskRegistry } from '../agent-runtime/tasks/TaskRegistry';
import { rdcSessionService } from '../sessions';
import { listSessionArtifactSources } from '../sessions/SessionArtifactSource';
import { storageAdapter } from '../sessions/StorageAdapter';
import { settingsService } from '../settings/SettingsService';
import { requestSnapshotStore } from '../agent-runtime/prompt';
import { mapRightRailInvestigationArtifacts } from './rightRailInvestigationArtifacts';
import { collectSessionTaskContextResources } from './rightRailTaskContextResources';
import {
  buildRdcContext,
  buildTaskContext,
  mapRightRailOutputs,
  mapRightRailProgress,
} from './rightRailProjectionMappers';

const emptyRightPanel = (sessionId: string): RightPanelViewModel => ({
  progress: [],
  artifacts: { rows: [], supersededCount: 0, truncatedCount: 0, storeDegraded: false },
  outputs: { current: [], previous: [] },
  context: {
    task: {
      projectId: '', projectName: '', sessionId, sessionTitle: '', workingDirectory: '',
      configurationPhase: 'next_turn', agentProfile: '', permission: 'default', resources: [],
    },
    rdc: {
      capture: null, availableCaptures: [],
      runtime: {}, diagnostics: [],
    },
  },
});

export class RightRailProjectionService {
  async build(input: {
    sessionId: string;
    branchId: string;
    runs: RunSummary[];
    events: ActionEvent[];
    profileId?: string;
  }): Promise<RightPanelViewModel> {
    const session = storageAdapter.readSession(input.sessionId);
    if (!session) return emptyRightPanel(input.sessionId);

    const taskRegistry = new TaskRegistry(createSessionTaskStore(input.sessionId));
    const [sources, taskRecords, conversations, requestSnapshots, artifacts] = await Promise.all([
      listSessionArtifactSources(input.sessionId),
      taskRegistry.reconcileInterruptedExecutions().then(() => taskRegistry.listTasks()),
      Promise.resolve(storageAdapter.readConversationHistory(input.sessionId)),
      Promise.resolve().then(() => requestSnapshotStore.list(input.sessionId)).catch(() => []),
      Promise.resolve().then(() => mapRightRailInvestigationArtifacts(input.sessionId)),
    ]);
    const project = storageAdapter.getProjectById(session.projectId);
    const openedCapture = rdcSessionService.snapshotOpenedCaptureForSession({
      projectId: session.projectId,
      sessionId: input.sessionId,
    });
    const contextSnapshot = rdcSessionService.snapshotContextForSession({
      projectId: session.projectId,
      sessionId: input.sessionId,
    });
    const progress = mapRightRailProgress(input.sessionId, input.branchId, taskRecords);
    const outputs = mapRightRailOutputs({
      sessionId: input.sessionId, branchId: input.branchId, sources, runs: input.runs,
    });
    const settings = settingsService.getAll();
    const taskResources = collectSessionTaskContextResources({
      messages: conversations,
      promptSegments: requestSnapshots.flatMap((snapshot) => snapshot.promptPlan.segments),
      projectRoot: project?.rootPath,
    });
    const task = buildTaskContext({
      session, project, runs: input.runs, profileId: input.profileId,
      attachments: sources, resources: taskResources,
      permissionMode: settings.agentRuntime.permissions.mode,
    });
    const projectInputs = await storageAdapter.listProjectInputs(session.projectId);
    const rdc = buildRdcContext({
      openedCapture,
      contextSnapshot,
      availableCaptures: projectInputs.map((capture) => ({
        inputId: capture.inputId, fileName: capture.fileName, filePath: capture.filePath, sizeBytes: capture.size,
      })),
    });
    return {
      progress,
      artifacts,
      outputs,
      context: { task, rdc },
    };
  }
}

export const rightRailProjectionService = new RightRailProjectionService();
