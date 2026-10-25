import { beforeEach, describe, expect, it, vi } from 'vitest';

const persistInvoke = vi.fn();
const projection = vi.hoisted(() => ({ projectId: 'project-a', sessionId: 'session-a' as string | null,
  current: vi.fn(), sessions: vi.fn(), listeners: new Set<() => void>() }));

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
      currentSession: projection.sessionId ? { sessionId: projection.sessionId } : null,
      currentProject: { projectId: projection.projectId },
      sessions: [],
      setCurrentSession: projection.current,
      setSessions: projection.sessions,
    }),
    subscribe: (listener: (state: unknown) => void) => {
      const notify = () => listener({ currentProject: { projectId: projection.projectId },
        currentSession: projection.sessionId ? { sessionId: projection.sessionId } : null });
      projection.listeners.add(notify); return () => projection.listeners.delete(notify);
    },
  },
}));

import { clearComposerModelChoice, commitComposerModelChoice } from './sessionModelOverride';
import {
  readComposerDraftModel,
  useComposerModelDraftStore,
  writeComposerDraftModel,
} from '../../stores/composerModelDraftStore';

beforeEach(() => {
  projection.projectId = 'project-a'; projection.sessionId = 'session-a';
  projection.current.mockClear(); projection.sessions.mockClear(); projection.listeners.clear();
});

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

it.each(['project', 'no-session', 'switch-back'])('does not project a late model save after %s navigation', async (kind) => {
  let finish!: (value: unknown) => void;
  persistInvoke.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  const pending = commitComposerModelChoice({ providerId: 'openai', modelId: 'model' }, 'session-a', 'project-a');
  if (kind === 'project') projection.projectId = 'project-b';
  else projection.sessionId = null;
  projection.listeners.forEach((listener) => listener());
  if (kind === 'switch-back') { projection.sessionId = 'session-a'; projection.listeners.forEach((listener) => listener()); }
  finish({ success: true, session: { sessionId: 'session-a', projectId: 'project-a' } });
  await pending;
  expect(projection.current).not.toHaveBeenCalled();
  expect(projection.sessions).not.toHaveBeenCalled();
  expect(projection.listeners.size).toBe(0);
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
