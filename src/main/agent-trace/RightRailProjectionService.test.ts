import { describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  project: {
    projectId: 'project-a', name: 'Project', rootPath: 'D:/project',
    inputs: [{ inputId: 'input-a', fileName: 'capture.rdc', filePath: 'D:/capture.rdc', size: 42 }],
  },
  listInputs: vi.fn(async () => { throw new Error('Projection must not rescan inputs'); }),
}));

vi.mock('../sessions/store/StorageAdapter', () => ({ storageAdapter: {
  readSession: () => ({ sessionId: 'session-a', projectId: 'project-a', title: 'Session', sessionPath: 'D:/session' }),
  readConversationHistory: () => [],
  getProjectById: () => state.project,
  listProjectInputs: state.listInputs,
} }));
vi.mock('../agent-runtime/tasks/sessionTaskStore', () => ({ createSessionTaskStore: () => ({}) }));
vi.mock('../agent-runtime/tasks/TaskRegistry', () => ({ TaskRegistry: class {
  async reconcileInterruptedExecutions() { return this; }
  async readConsistentSnapshot() { return { tasks: [], executions: [] }; }
} }));
vi.mock('../sessions', () => ({ rdcSessionService: {
  snapshotOpenedCaptureForSession: () => null,
  snapshotContextForSession: () => null,
} }));
vi.mock('../sessions/artifacts/SessionArtifactSource', () => ({ listSessionArtifactSources: async () => [] }));
vi.mock('../agent-runtime/permissions/RuntimePermissionStateService', () => ({ runtimePermissionStateService: {
  getSnapshot: () => ({ mode: 'default' }),
} }));
vi.mock('../agent-runtime/prompt', () => ({ requestSnapshotStore: { listPromptSegments: () => [] } }));
vi.mock('./rightRailInvestigationArtifacts', () => ({ mapRightRailInvestigationArtifacts: () => ({ rows: [], totalCount: 0, storeDegraded: false }) }));
vi.mock('./rightRailTaskContextResources', () => ({ collectSessionTaskContextResources: () => [] }));
vi.mock('./manifests/AgentProfileRegistry', () => ({ agentProfileRegistry: { getForMode: () => ({ displayName: 'General' }) } }));

import { RightRailProjectionService } from './RightRailProjectionService';

describe('RightRailProjectionService', () => {
  it('projects the latest persisted input snapshot without starting a new capture scan', async () => {
    const service = new RightRailProjectionService();
    const input = { sessionId: 'session-a', branchId: 'branch-a', runs: [], events: [] };
    const first = await service.build(input);
    expect(first.context.rdc.availableCaptures).toEqual([
      { inputId: 'input-a', fileName: 'capture.rdc', filePath: 'D:/capture.rdc', sizeBytes: 42 },
    ]);
    state.project.inputs = [];
    const second = await service.build(input);
    expect(second.context.rdc.availableCaptures).toEqual([]);
    expect(state.listInputs).not.toHaveBeenCalled();
  });
});
