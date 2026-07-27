import type { ActionEvent } from '@shared/types/evidence';
import type { RunSummary } from '@shared/types/session';
import type { AppMode } from '@shared/types/session';
import type { RightPanelViewModel } from '@shared/types/trace';
import { createSessionTaskStore } from '../agent-runtime/tasks/sessionTaskStore';
import { rdxSessionService } from '../sessions';
import { listSessionArtifactSources } from '../sessions/SessionArtifactSource';
import { storageAdapter } from '../sessions/StorageAdapter';
import { settingsService } from '../settings/SettingsService';
import { collectSessionUsedToolNames } from './rightRailTaskContextResources';
import {
  buildRdxContext,
  buildTaskContext,
  mapRightRailArtifacts,
  mapRightRailProgress,
} from './rightRailProjectionMappers';

const emptyRightPanel = (sessionId: string): RightPanelViewModel => ({
  progress: { current: [], history: [] },
  artifacts: { current: [], previous: [] },
  context: {
    task: {
      projectId: '', projectName: '', sessionId, sessionTitle: '', workingDirectory: '',
      configurationPhase: 'next_turn', agentProfile: 'Ask', permission: 'default', resources: [],
    },
    rdx: {
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
    mode: AppMode;
  }): Promise<RightPanelViewModel> {
    const session = storageAdapter.readSession(input.sessionId);
    if (!session) return emptyRightPanel(input.sessionId);

    const [sources, taskRecords, conversations] = await Promise.all([
      listSessionArtifactSources(input.sessionId),
      createSessionTaskStore(input.sessionId).listTasks().catch(() => []),
      Promise.resolve(storageAdapter.readConversationHistory(input.sessionId)),
    ]);
    const project = storageAdapter.getProjectById(session.projectId);
    const openedCapture = rdxSessionService.snapshotOpenedCaptureForSession({
      projectId: session.projectId,
      sessionId: input.sessionId,
    });
    const contextSnapshot = rdxSessionService.snapshotContextForSession({
      projectId: session.projectId,
      sessionId: input.sessionId,
    });
    const progress = mapRightRailProgress(input.sessionId, input.branchId, taskRecords);
    const artifacts = mapRightRailArtifacts({
      sessionId: input.sessionId, branchId: input.branchId, sources, runs: input.runs,
    });
    const task = buildTaskContext({
      session, project, runs: input.runs, events: input.events, mode: input.mode,
      attachments: sources, settings: settingsService.getAll(),
      usedToolNames: collectSessionUsedToolNames(conversations),
    });
    const rdx = buildRdxContext({
      openedCapture,
      contextSnapshot,
      availableCaptures: storageAdapter.listProjectInputs(session.projectId).map((capture) => ({
        inputId: capture.inputId, fileName: capture.fileName, filePath: capture.filePath, sizeBytes: capture.size,
      })),
    });
    return {
      progress: {
        current: progress.filter((task) => ['running', 'blocked', 'pending', 'reopened'].includes(task.status)),
        history: progress.filter((task) => ['completed', 'cancelled'].includes(task.status)),
      },
      artifacts,
      context: { task, rdx },
    };
  }
}

export const rightRailProjectionService = new RightRailProjectionService();
