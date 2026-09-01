import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadSessionsOp, type ProjectSelectionLoaderOpsContext } from './projectSelectionLoaderOps';
import type { ProjectRecord } from '@shared/types/session';

const reloadSettings = vi.fn(async () => ({ agents: { definitions: [{ id: 'project-only' }] } }));

vi.mock('../../../stores/conversationStore', () => ({
  useConversationStore: { getState: () => ({ setTimeline: vi.fn() }) },
}));
vi.mock('../../../stores/projectStore', () => ({
  useProjectStore: { getState: () => ({ currentProject: null, currentSession: null, rightRailTarget: 'project' }) },
}));
vi.mock('../../../stores/sessionStore', () => ({
  useSessionStore: { getState: () => ({ currentRun: null, runs: [], clearUsageSnapshot: vi.fn() }) },
}));
vi.mock('../../../stores/captureStore', () => ({
  useCaptureStore: { getState: () => ({ captures: [] }) },
}));
vi.mock('../../../app/bootstrap/sessionSwitchHygiene', () => ({
  applySessionSwitchHygiene: vi.fn(),
}));

function project(projectId: string): ProjectRecord {
  return {
    projectId,
    name: projectId,
    rootPath: `D:/${projectId}`,
    slug: projectId,
    resourcePath: '',
    knowledgePath: '',
    inputsPath: '',
    inputs: [],
    inputsUpdatedAt: 0,
    createdAt: 0,
    updatedAt: 0,
  };
}

describe('loadSessionsOp project-aware settings refresh', () => {
  const selectProject = vi.fn(async () => ({ success: true, project: project('proj_b') }));

  beforeEach(() => {
    reloadSettings.mockClear();
    selectProject.mockClear();
    vi.stubGlobal('window', {
      electronAPI: {
        project: {
          select: selectProject,
        },
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reloads project-aware settings after a real project select', async () => {
    const order: string[] = [];
    selectProject.mockImplementation(async () => {
      order.push('select');
      return { success: true, project: project('proj_b') };
    });
    reloadSettings.mockImplementation(async () => {
      order.push('reloadSettings');
      return { agents: { definitions: [{ id: 'project-only' }] } };
    });
    const setCurrentProject = vi.fn(() => {
      order.push('setCurrentProject');
    });

    const ctx = {
      t: (key: string) => key,
      setSidebarError: vi.fn(),
      ensureProjectExpanded: vi.fn(),
      loadProjectSessionList: vi.fn(async () => []),
      pruneTreeForProjects: vi.fn(),
      resetTree: vi.fn(),
      isLatestSelectionRequest: () => true,
      setProjects: vi.fn(),
      setSessions: vi.fn(),
      setCurrentProject,
      setCurrentSession: vi.fn(),
      setProjectInputs: vi.fn(),
      updateProjectInputs: vi.fn(),
      setRightRailTarget: vi.fn(),
      setCurrentRun: vi.fn(),
      setRuns: vi.fn(),
      setCaptures: vi.fn(),
      getCurrentSession: () => null,
      reloadSettings,
    } as unknown as ProjectSelectionLoaderOpsContext;

    await loadSessionsOp(ctx, project('proj_b'), { autoSelectSession: false, requestId: 1 });

    expect(selectProject).toHaveBeenCalledWith('proj_b');
    expect(reloadSettings).toHaveBeenCalledTimes(1);
    expect(setCurrentProject).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'proj_b' }));
    expect(order).toEqual(['select', 'reloadSettings', 'setCurrentProject']);
  });
});
