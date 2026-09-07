import { beforeEach, describe, expect, it, vi } from 'vitest';

const setSelectedAgentId = vi.fn();
const setCurrentSession = vi.fn();
const setSessions = vi.fn();
const setAgentId = vi.fn();

vi.mock('../../stores/layoutStore', () => ({
  useLayoutStore: { getState: () => ({ setSelectedAgentId }) },
}));

vi.mock('../../stores/projectStore', () => ({
  useProjectStore: {
    getState: () => ({
      currentSession: { sessionId: 'sess_1', agentId: 'plan' },
      sessions: [{ sessionId: 'sess_1', agentId: 'plan' }],
      setCurrentSession,
      setSessions,
    }),
  },
}));

vi.mock('../../platform/getElectronApi', () => ({
  getElectronApi: () => ({ session: { setAgentId } }),
}));

import { hydrateComposerAgentFromSession } from '../../stores/sessionAgentHydration';
import { persistSessionAgentId } from './sessionAgentId';

describe('session agentId pill hydrate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setAgentId.mockResolvedValue({
      success: true,
      session: { sessionId: 'sess_1', agentId: 'edit' },
    });
  });

  it('hydrates the Composer pill from SessionRecord.agentId', () => {
    hydrateComposerAgentFromSession({
      sessionId: 'sess_1',
      projectId: 'proj_1',
      title: 't',
      goal: '',
      sessionPath: 'D:/sess',
      createdAt: 1,
      updatedAt: 1,
      agentId: 'debugger',
    });
    expect(setSelectedAgentId).toHaveBeenCalledWith('debugger');
  });

  it('falls back to general when session.agentId is missing', () => {
    hydrateComposerAgentFromSession({
      sessionId: 'sess_1',
      projectId: 'proj_1',
      title: 't',
      goal: '',
      sessionPath: 'D:/sess',
      createdAt: 1,
      updatedAt: 1,
    });
    expect(setSelectedAgentId).toHaveBeenCalledWith('general');
  });

  it('persists a manual Agent switch through main', async () => {
    await persistSessionAgentId('sess_1', 'edit');
    expect(setAgentId).toHaveBeenCalledWith('sess_1', 'edit');
    expect(setSelectedAgentId).toHaveBeenCalledWith('edit');
  });
});
