import { beforeEach, describe, expect, it, vi } from 'vitest';

const persistInvoke = vi.fn();

vi.mock('../../platform/getElectronApi', () => ({
  getElectronApi: () => ({
    session: {
      setModelOverride: persistInvoke,
      create: vi.fn(),
      select: vi.fn(),
    },
  }),
}));

vi.mock('../../stores/projectStore', () => ({
  useProjectStore: {
    getState: () => ({
      currentSession: null,
      currentProject: { projectId: 'project-a' },
      sessions: [],
      setCurrentSession: vi.fn(),
      setSessions: vi.fn(),
    }),
  },
}));

import { clearComposerModelChoice, commitComposerModelChoice } from './sessionModelOverride';
import {
  readComposerDraftModel,
  useComposerModelDraftStore,
  writeComposerDraftModel,
} from '../../stores/composerModelDraftStore';

describe('commitComposerModelChoice', () => {
  beforeEach(() => {
    persistInvoke.mockReset();
    useComposerModelDraftStore.getState().reset();
  });

  it('writes a no-session draft and does not create or persist a session', async () => {
    const result = await commitComposerModelChoice(
      { providerId: 'openai', modelId: 'gpt-5.6-sol' },
      null,
      'project-a',
    );
    expect(result).toEqual({ ok: true });
    expect(persistInvoke).not.toHaveBeenCalled();
    expect(readComposerDraftModel('project-a')).toEqual({
      providerId: 'openai',
      modelId: 'gpt-5.6-sol',
    });
  });
});

describe('clearComposerModelChoice', () => {
  beforeEach(() => {
    persistInvoke.mockReset();
    useComposerModelDraftStore.getState().reset();
  });

  it('persists a null session override when a session exists', async () => {
    persistInvoke.mockResolvedValue({
      success: true,
      session: {
        sessionId: 'session-a',
        projectId: 'project-a',
        title: 'A',
        goal: '',
        sessionPath: '/tmp/session-a',
        createdAt: 1,
        updatedAt: 2,
        modelOverride: null,
      },
    });
    const result = await clearComposerModelChoice('session-a', 'project-a');
    expect(result).toEqual({ ok: true });
    expect(persistInvoke).toHaveBeenCalledWith('session-a', null);
  });

  it('clears the no-session draft and does not invoke IPC', async () => {
    writeComposerDraftModel('project-a', { providerId: 'openai', modelId: 'gpt-5.6-sol' });
    const result = await clearComposerModelChoice(null, 'project-a');
    expect(result).toEqual({ ok: true });
    expect(persistInvoke).not.toHaveBeenCalled();
    expect(readComposerDraftModel('project-a')).toBeNull();
  });
});
