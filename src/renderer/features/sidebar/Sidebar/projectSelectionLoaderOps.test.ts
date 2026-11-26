import { AppError } from '@shared/errors/appError';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applySessionSwitchHygiene } from '../../../stores/sessionSwitchHygiene';
import { handleProjectSelectOp, loadProjectsOp, loadSessionsOp } from './projectSelectionProjectOps';
import { handleSessionActivateOp, handleSessionCreateOp, selectSessionOp } from './projectSelectionSessionOps';
import type { ProjectSelectionHandlerOpsContext, ProjectSelectionLoaderOpsContext } from './projectSelectionContext';
import type { ProjectRecord } from '@shared/types/session';

const reloadSettings = vi.fn(async () => ({ agents: { definitions: [{ id: 'project-only' }] } }));
const activateSession = vi.hoisted(() => vi.fn());

vi.mock('../../../stores/conversationStore', () => ({
  useConversationStore: {
    getState: () => ({ setTimeline: vi.fn(), historyLoadingSessionId: null, setHistoryLoadingSessionId: vi.fn() }),
  },
}));
vi.mock('../../../stores/sessionProjectionHydration', () => ({ hydrateLoadedSessionSurface: vi.fn() }));
vi.mock('../../../stores/projectStore', () => ({
  useProjectStore: { getState: () => ({ currentProject: null, currentSessionId: null, rightRailTarget: 'project' }) },
}));
vi.mock('../../../stores/sessionStore', () => ({
  useSessionStore: { getState: () => ({ currentRun: null, clearUsageSnapshot: vi.fn() }) },
}));
vi.mock('../../../stores/captureStore', () => ({
  useCaptureStore: { getState: () => ({ captures: [] }) },
}));
vi.mock('../../../stores/sessionSwitchHygiene', () => ({
  applySessionSwitchHygiene: vi.fn(),
}));
vi.mock('../../../stores/sessionProjectionStore', () => ({
  useSessionProjectionStore: { getState: () => ({ activateSession }) },
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

it.each([false, true])(
  'preserves review and handoff state on same-session revalidation (optimistic=%s)',
  async (optimistic) => {
    vi.mocked(applySessionSwitchHygiene).mockClear();
    const session = { sessionId: 'session-a', projectId: 'proj_a', agentId: 'general' } as never;
    vi.stubGlobal('window', {
      electronAPI: {
        session: {
          open: async () => ({
            success: true,
            session: { record: session, revision: { epoch: 'e', n: 1 } },
            currentRun: null,
            runs: [],
            history: { messages: [], planReview: null, branchState: null },
            trace: { success: true, presentation: null },
          }),
        },
      },
    });
    const ctx = {
      getCurrentSession: () => session,
      isLatestSelectionRequest: () => true,
      setCurrentSessionId: vi.fn(),
      setRightRailTarget: vi.fn(),
      setCurrentRun: vi.fn(),
      setCaptures: vi.fn(),
    } as unknown as ProjectSelectionLoaderOpsContext;
    try {
      expect(await selectSessionOp(ctx, 'session-a', optimistic ? { optimisticSession: session } : {})).toBe(true);
      expect(applySessionSwitchHygiene).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  },
);

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
      setCurrentSessionId: vi.fn(),
      setProjectInputs: vi.fn(),
      updateProjectInputs: vi.fn(),
      setRightRailTarget: vi.fn(),
      setCurrentRun: vi.fn(),
      setCaptures: vi.fn(),
      getCurrentSession: () => null,
      reloadSettings,
    } as unknown as ProjectSelectionLoaderOpsContext;

    await loadSessionsOp(ctx, project('proj_b'), { autoSelectSession: false, requestId: 1 });

    expect(selectProject).toHaveBeenCalledWith('proj_b');
    expect(reloadSettings).toHaveBeenCalledExactlyOnceWith('proj_b');
    expect(setCurrentProject).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'proj_b' }));
    expect(order).toEqual(['select', 'reloadSettings', 'setCurrentProject']);
  });

  it('clears the former session projection when project-only selection crosses projects', async () => {
    const setCurrentSessionId = vi.fn();
    const ctx = {
      t: (key: string) => key,
      setSidebarError: vi.fn(),
      ensureProjectExpanded: vi.fn(),
      loadProjectSessionList: vi.fn(async () => []),
      isLatestSelectionRequest: () => true,
      setSessions: vi.fn(),
      setCurrentProject: vi.fn(),
      setCurrentSessionId,
      updateProjectInputs: vi.fn(),
      setRightRailTarget: vi.fn(),
      setCurrentRun: vi.fn(),
      setCaptures: vi.fn(),
      getCurrentSession: () => ({ sessionId: 'session-a', projectId: 'proj_a' }),
      reloadSettings,
    } as unknown as ProjectSelectionLoaderOpsContext;

    await loadSessionsOp(ctx, project('proj_b'), { autoSelectSession: false, requestId: 1 });

    expect(applySessionSwitchHygiene).toHaveBeenCalledWith({ previousSessionId: 'session-a', nextSessionId: null });
    expect(setCurrentSessionId).toHaveBeenCalledWith(null);
  });
});

it('clears the active session before projecting another project root', async () => {
  const order: string[] = [];
  vi.mocked(applySessionSwitchHygiene).mockImplementation(() => {
    order.push('hygiene');
  });
  const ctx = {
    setSidebarError: vi.fn(),
    beginSelectionRequest: () => 1,
    getCurrentSession: () => ({ sessionId: 'session-a', projectId: 'proj_a' }),
    setCurrentSessionId: () => {
      order.push('clearSession');
    },
    setCurrentRun: vi.fn(),
    setCaptures: vi.fn(),
    setCurrentProject: () => {
      order.push('setProject');
    },
    updateProjectInputs: vi.fn(),
    setRightRailTarget: vi.fn(),
    ensureProjectExpanded: vi.fn(),
    setIsBusy: vi.fn(),
    loadSessions: async () => {
      order.push('loadSessions');
    },
  } as unknown as ProjectSelectionHandlerOpsContext;

  await handleProjectSelectOp(ctx, project('proj_b'));

  expect(applySessionSwitchHygiene).toHaveBeenCalledWith({ previousSessionId: 'session-a', nextSessionId: null });
  expect(order).toEqual(['hygiene', 'clearSession', 'setProject', 'loadSessions']);
});

it('clears the former session before projecting a session in another project', async () => {
  const order: string[] = [];
  vi.mocked(applySessionSwitchHygiene).mockImplementation(() => {
    order.push('hygiene');
  });
  const ctx = {
    setSidebarError: vi.fn(),
    beginSelectionRequest: () => 1,
    getCurrentProject: () => project('proj_a'),
    getCurrentSession: () => ({ sessionId: 'session-a', projectId: 'proj_a' }),
    setCurrentProject: () => {
      order.push('setProject');
    },
    setCurrentSessionId: () => {
      order.push('setSession');
    },
    setRightRailTarget: vi.fn(),
    setCurrentRun: vi.fn(),
    setCaptures: vi.fn(),
    ensureProjectExpanded: vi.fn(),
    setIsBusy: vi.fn(),
    loadSessions: async () => {
      order.push('loadSessions');
    },
  } as unknown as ProjectSelectionHandlerOpsContext;

  await handleSessionActivateOp(
    ctx,
    project('proj_b'),
    {
      sessionId: 'session-b',
      projectId: 'proj_b',
    } as Parameters<typeof handleSessionActivateOp>[2],
    vi.fn(),
  );

  expect(applySessionSwitchHygiene).toHaveBeenCalledWith({
    previousSessionId: 'session-a',
    nextSessionId: 'session-b',
  });
  expect(order).toEqual(['hygiene', 'setProject', 'setSession', 'loadSessions']);
});

it('restores the former selection when cross-project activation is rejected', async () => {
  const formerProject = project('proj_a');
  const formerSession = { sessionId: 'session-a', projectId: 'proj_a' } as Parameters<
    typeof handleSessionActivateOp
  >[2];
  const setCurrentProject = vi.fn();
  const setCurrentSessionId = vi.fn();
  vi.stubGlobal('window', {
    electronAPI: {
      project: {
        select: async () => {
          throw new AppError('PROJECT_NOT_FOUND', 'rejected');
        },
      },
    },
  });
  const ctx = {
    t: (key: string) => key,
    setSidebarError: vi.fn(),
    isLatestSelectionRequest: () => true,
    setCurrentProject,
    setCurrentSessionId,
    setRightRailTarget: vi.fn(),
    setCurrentRun: vi.fn(),
    setCaptures: vi.fn(),
    ensureProjectExpanded: vi.fn(),
  } as unknown as ProjectSelectionLoaderOpsContext;

  await loadSessionsOp(ctx, project('proj_b'), {
    rollbackState: {
      currentProject: formerProject,
      currentSessionId: formerSession.sessionId,
      rightRailTarget: 'session',
      currentRun: null,
      captures: [],
    },
  });

  expect(ctx.setSidebarError).toHaveBeenCalledWith({
    contextKey: 'sidebar.selectProjectFailed',
    reason: expect.objectContaining({ code: 'PROJECT_NOT_FOUND' }),
  });
  expect(setCurrentProject).toHaveBeenLastCalledWith(formerProject);
  expect(setCurrentSessionId).toHaveBeenLastCalledWith('session-a');
  expect(activateSession).toHaveBeenCalledWith('session-a');
  vi.unstubAllGlobals();
});

describe('loadProjectsOp listing gate', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('notifies as soon as the project list is written, before session restore', async () => {
    const setProjects = vi.fn();
    const onProjectsListed = vi.fn();
    const reloadSettings = vi.fn(async () => undefined);
    const order: string[] = [];
    setProjects.mockImplementation(() => {
      order.push('setProjects');
    });
    onProjectsListed.mockImplementation(() => {
      order.push('onProjectsListed');
    });
    reloadSettings.mockImplementation(async () => {
      order.push('reloadSettings');
    });

    vi.stubGlobal('window', {
      electronAPI: {
        project: {
          list: async () => ({ projects: [] }),
        },
      },
    });

    const ctx = {
      t: (key: string) => key,
      setSidebarError: vi.fn(),
      ensureProjectExpanded: vi.fn(),
      loadProjectSessionList: vi.fn(async () => []),
      pruneTreeForProjects: vi.fn(),
      resetTree: vi.fn(),
      isLatestSelectionRequest: () => true,
      setProjects,
      setSessions: vi.fn(),
      setCurrentProject: vi.fn(),
      setCurrentSessionId: vi.fn(),
      setProjectInputs: vi.fn(),
      updateProjectInputs: vi.fn(),
      setRightRailTarget: vi.fn(),
      setCurrentRun: vi.fn(),
      setCaptures: vi.fn(),
      getCurrentSession: () => null,
      reloadSettings,
    } as unknown as ProjectSelectionLoaderOpsContext;

    await loadProjectsOp(ctx, null, null, { onProjectsListed, requestId: 1 });

    expect(order.slice(0, 2)).toEqual(['setProjects', 'onProjectsListed']);
    expect(order).toContain('reloadSettings');
  });
});

it('creates a session in the current project with one open request and no project reload', async () => {
  const current = project('proj_a');
  const created = { sessionId: 'session-new', projectId: 'proj_a' } as never;
  const calls: string[] = [];
  vi.stubGlobal('window', {
    electronAPI: {
      session: {
        create: async () => {
          calls.push('create');
          return { success: true, session: { record: created, revision: { epoch: 'e', n: 1 } } };
        },
        open: async () => {
          calls.push('open');
          return {
            success: true,
            session: { record: created, revision: { epoch: 'e', n: 1 } },
            currentRun: null,
            runs: [],
            history: { messages: [], planReview: null, branchState: null },
            trace: { success: true, presentation: null },
          };
        },
      },
    },
  });
  const ctx = {
    setSidebarError: vi.fn(),
    getCurrentProject: () => current,
    projectMenuOpen: false,
    beginSelectionRequest: () => 1,
    setIsBusy: vi.fn(),
    isLatestSelectionRequest: () => true,
    getCurrentSession: () => null,
    setCurrentProject: vi.fn(),
    setCurrentSessionId: vi.fn(),
    setRightRailTarget: vi.fn(),
    setCurrentRun: vi.fn(),
    setCaptures: vi.fn(),
    ensureProjectExpanded: vi.fn(),
    loadProjects: vi.fn(),
    setSessions: vi.fn(),
    loadProjectSessionList: vi.fn(async () => {
      calls.push('list');
      return [created];
    }),
  } as unknown as ProjectSelectionHandlerOpsContext;
  try {
    await handleSessionCreateOp(ctx);
    expect([...calls].sort()).toEqual(['create', 'list', 'open']);
    expect(ctx.loadProjects).not.toHaveBeenCalled();
    expect(ctx.setSessions).toHaveBeenCalledWith([created]);
  } finally {
    vi.unstubAllGlobals();
  }
});
