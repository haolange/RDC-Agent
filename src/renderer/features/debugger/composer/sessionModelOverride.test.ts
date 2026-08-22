import { beforeEach, describe, expect, it, vi } from 'vitest';

const persistInvoke = vi.fn();

vi.mock('../../../platform/getElectronApi', () => ({
  getElectronApi: () => ({
    session: {
      setModelOverride: persistInvoke,
      create: vi.fn(),
      select: vi.fn(),
    },
  }),
}));

vi.mock('../../../stores/projectStore', () => ({
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

import { commitComposerModelChoice } from './sessionModelOverride';
import {
  readComposerDraftModel,
  useComposerModelDraftStore,
} from './composerModelDraft';

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
