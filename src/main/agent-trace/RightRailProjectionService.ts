import { createSessionTaskStore } from '../agent-runtime/tasks/sessionTaskStore';
import { TaskRegistry } from '../agent-runtime/tasks/TaskRegistry';
import { rdcSessionService } from '../rdc/RdcSessionService';
import { listSessionArtifactSources } from '../reports/SessionArtifactSource';
import { conversationHistoryStore, projectWorkspaceStore, sessionRecordStore } from '../sessions/store/sessionStores';
import { runtimePermissionStateService } from '../runtime/RuntimePermissionStateService';
import { requestSnapshotStore } from '../agent-runtime/prompt';
import { mapRightRailInvestigationArtifacts } from './rightRailInvestigationArtifacts';
import { collectSessionTaskContextResources } from './rightRailTaskContextResources';
import {
  buildRdcContext,
  buildTaskContext,
  mapRightRailOutputs,
  mapRightRailTasks,
} from './rightRailProjectionMappers';
import type { RightPanelViewModel } from '@shared/types/trace';
import type { RunSummary } from '@shared/types/session';
import type { ActionEvent } from '@shared/types/evidence';

const emptyRightPanel = (sessionId: string): RightPanelViewModel => ({
  tasks: [],
  artifacts: { rows: [], totalCount: 0, storeDegraded: false },
  outputs: { current: [], previous: [] },
  context: {
    task: {
      projectId: '',
      projectName: '',
      sessionId,
      sessionTitle: '',
      workingDirectory: '',
      configurationPhase: 'next_turn',
      agentProfile: '',
      permission: 'default',
      resources: [],
    },
    rdc: {
      capture: null,
      availableCaptures: [],
      runtime: {},
      diagnostics: [],
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
    const session = sessionRecordStore.readSession(input.sessionId);
    if (!session) return emptyRightPanel(input.sessionId);

    const taskRegistry = new TaskRegistry(createSessionTaskStore(input.sessionId));
    const [sources, taskSnapshot, conversations, promptSegments, artifacts] = await Promise.all([
      listSessionArtifactSources(input.sessionId),
      taskRegistry.reconcileInterruptedExecutions().then(() => taskRegistry.readConsistentSnapshot()),
      Promise.resolve(conversationHistoryStore.readConversationHistory(input.sessionId)),
      Promise.resolve()
        .then(() => requestSnapshotStore.listPromptSegments(input.sessionId))
        .catch(() => []),
      Promise.resolve().then(() => mapRightRailInvestigationArtifacts(input.sessionId)),
    ]);
    const project = projectWorkspaceStore.getProjectById(session.projectId);
    const openedCapture = rdcSessionService.snapshotOpenedCaptureForSession({
      projectId: session.projectId,
      sessionId: input.sessionId,
    });
    const contextSnapshot = rdcSessionService.snapshotContextForSession({
      projectId: session.projectId,
      sessionId: input.sessionId,
    });
    const tasks = mapRightRailTasks(input.sessionId, input.branchId, taskSnapshot.tasks, taskSnapshot.executions);
    const outputs = mapRightRailOutputs({
      sessionId: input.sessionId,
      branchId: input.branchId,
      sources,
      runs: input.runs,
    });
    const permissionState = runtimePermissionStateService.getSnapshot();
    const taskResources = collectSessionTaskContextResources({
      messages: conversations,
      promptSegments,
      projectRoot: project?.rootPath,
    });
    const task = buildTaskContext({
      session,
      project,
      runs: input.runs,
      profileId: input.profileId,
      attachments: sources,
      resources: taskResources,
      permissionMode: permissionState.mode,
    });
    // Projection consumes the last committed scan; it must not enqueue a new
    // full capture hash for every trace update. Opening and plan approval
    // independently verify the selected input's current identity.
    const projectInputs = project?.inputs ?? [];
    const rdc = buildRdcContext({
      openedCapture,
      contextSnapshot,
      availableCaptures: projectInputs.map((capture) => ({
        inputId: capture.inputId,
        fileName: capture.fileName,
        filePath: capture.filePath,
        sizeBytes: capture.size,
      })),
    });
    return {
      tasks,
      artifacts,
      outputs,
      context: { task, rdc },
    };
  }
}

export const rightRailProjectionService = new RightRailProjectionService();
