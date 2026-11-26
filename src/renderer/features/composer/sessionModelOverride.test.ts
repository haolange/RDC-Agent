import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '@shared/errors/appError';

const persistInvoke = vi.fn();
const projection = vi.hoisted(() => ({
  projectId: 'project-a',
  sessionId: 'session-a' as string | null,
  listeners: new Set<() => void>(),
}));
let revision = 0;
/** What main answers: the session record it wrote, with that write's revision. */
const saved = (patch: Record<string, unknown> = {}) => ({
  success: true,
  session: {
    record: {
      sessionId: 'session-a',
      projectId: 'project-a',
      title: 'A',
      goal: '',
      sessionPath: '/a',
      createdAt: 1,
      updatedAt: 1,
      ...patch,
    },
    revision: { epoch: 'run-1', n: ++revision },
  },
});

vi.mock('../../platform/getElectronApi', () => ({
  getElectronApi: () => ({
    session: {
      setModelOverride: persistInvoke,
      create: vi.fn(),
      open: vi.fn(),
    },
  }),
}));

vi.mock('../../stores/projectStore', () => ({
  useProjectStore: {
    getState: () => ({
      currentSessionId: projection.sessionId,
      currentProject: { projectId: projection.projectId },
    }),
    subscribe: (listener: (state: unknown) => void) => {
      const notify = () =>
        listener({ currentProject: { projectId: projection.projectId }, currentSessionId: projection.sessionId });
      projection.listeners.add(notify);
      return () => projection.listeners.delete(notify);
    },
  },
}));

import {
  readComposerDraftModel,
  useComposerModelDraftStore,
  writeComposerDraftModel,
} from '../../stores/composerModelDraftStore';
import { getSessionView, useSessionRecordStore } from '../../stores/sessionRecordStore';
import {
  clearComposerModelChoice,
  commitComposerModelChoice,
  persistSessionTurnControls,
  flushSessionModelSaves,
} from './sessionModelOverride';

beforeEach(() => {
  projection.projectId = 'project-a';
  projection.sessionId = 'session-a';
  projection.listeners.clear();
  useSessionRecordStore.getState().reset();
});

it('sends controls at once beside a model save and holds approval until both have landed', async () => {
  let finishModel!: (value: unknown) => void;
  persistInvoke
    .mockReset()
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishModel = resolve;
        }),
    )
    .mockResolvedValueOnce(saved());
  const first = commitComposerModelChoice({ providerId: 'p', modelId: 'm' }, 'session-a', 'project-a');
  const controls = { reasoningLevel: 'high' as const, fastModel: true, maxContextMode: true };
  const second = persistSessionTurnControls('session-a', controls);
  let flushed = false;
  const barrier = flushSessionModelSaves('session-a').then(() => {
    flushed = true;
  });
  // Main orders each field by revision, so nothing waits in a renderer queue.
  expect(persistInvoke).toHaveBeenCalledTimes(2);
  const [[, modelWrite], [, controlsWrite]] = persistInvoke.mock.calls as Array<[string, { clientRevision: number }]>;
  expect(modelWrite).toEqual({ modelOverride: { providerId: 'p', modelId: 'm' }, clientRevision: expect.any(Number) });
  expect(controlsWrite).toEqual({ turnControls: controls, clientRevision: expect.any(Number) });
  expect(controlsWrite.clientRevision).toBeGreaterThan(modelWrite.clientRevision);
  await second;
  expect(flushed).toBe(false);
  finishModel(saved());
  await Promise.all([first, barrier]);
  expect(flushed).toBe(true);
});

it('includes a save begun while approval already waits, and fails approval when the newest save failed', async () => {
  let finishFirst!: (value: unknown) => void;
  let failSecond!: (reason: unknown) => void;
  persistInvoke
    .mockReset()
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishFirst = resolve;
        }),
    )
    .mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          failSecond = reject;
        }),
    );
  const first = commitComposerModelChoice({ providerId: 'p', modelId: 'm' }, 'session-a', 'project-a');
  let flushed = false;
  const barrier = flushSessionModelSaves('session-a').then(
    () => {
      flushed = true;
    },
    (error: Error) => error.message,
  );
  const second = persistSessionTurnControls('session-a', {
    reasoningLevel: 'low',
    fastModel: true,
    maxContextMode: true,
  });
  finishFirst(saved());
  await first;
  expect(flushed).toBe(false);
  failSecond(new AppError('MODEL_UNAVAILABLE'));
  expect(await second).toEqual({
    ok: false,
    error: expect.objectContaining({ code: 'MODEL_UNAVAILABLE' }),
    latest: true,
  });
  await expect(barrier).resolves.toBe('MODEL_UNAVAILABLE');
});

it('reports a save as no longer the latest once a later choice of the same field began', async () => {
  let finishFirst!: (value: unknown) => void;
  persistInvoke
    .mockReset()
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishFirst = resolve;
        }),
    )
    .mockResolvedValueOnce(saved());
  const first = persistSessionTurnControls('session-a', {
    reasoningLevel: 'low',
    fastModel: false,
    maxContextMode: false,
  });
  const second = persistSessionTurnControls('session-a', {
    reasoningLevel: 'high',
    fastModel: false,
    maxContextMode: false,
  });
  expect(await second).toEqual({ ok: true, latest: true });
  finishFirst(saved());
  expect(await first).toEqual({ ok: true, latest: false });
});

it('shows a chosen model while it saves and returns to the saved model when main refuses it', async () => {
  useSessionRecordStore.getState().accept(saved({ modelOverride: { providerId: 'p', modelId: 'old' } }).session);
  let fail!: (reason: unknown) => void;
  persistInvoke.mockReset().mockImplementationOnce(
    () =>
      new Promise((_resolve, reject) => {
        fail = reject;
      }),
  );
  const pending = commitComposerModelChoice({ providerId: 'p', modelId: 'new' }, 'session-a', 'project-a');
  expect(getSessionView('session-a')?.modelOverride).toEqual({ providerId: 'p', modelId: 'new' });
  fail(new AppError('MODEL_UNAVAILABLE'));
  expect(await pending).toEqual({
    ok: false,
    error: expect.objectContaining({ code: 'MODEL_UNAVAILABLE' }),
    latest: true,
  });
  expect(getSessionView('session-a')?.modelOverride).toEqual({ providerId: 'p', modelId: 'old' });
});

describe('commitComposerModelChoice', () => {
  beforeEach(() => {
    persistInvoke.mockReset();
    useComposerModelDraftStore.getState().reset();
  });

  it('writes a no-session draft and does not create or persist a session', async () => {
    const result = await commitComposerModelChoice({ providerId: 'openai', modelId: 'gpt-5.6-sol' }, null, 'project-a');
    expect(result).toEqual({ ok: true });
    expect(persistInvoke).not.toHaveBeenCalled();
    expect(readComposerDraftModel('project-a')).toEqual({
      providerId: 'openai',
      modelId: 'gpt-5.6-sol',
    });
  });
});

it.each(['project', 'no-session', 'switch-back'])(
  'keeps a late model save on its own session after %s navigation',
  async (kind) => {
    let finish!: (value: unknown) => void;
    persistInvoke.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const pending = commitComposerModelChoice({ providerId: 'openai', modelId: 'model' }, 'session-a', 'project-a');
    if (kind === 'project') projection.projectId = 'project-b';
    else projection.sessionId = null;
    projection.listeners.forEach((listener) => listener());
    if (kind === 'switch-back') {
      projection.sessionId = 'session-a';
      projection.listeners.forEach((listener) => listener());
    }
    finish(saved({ modelOverride: { providerId: 'openai', modelId: 'model' } }));
    await pending;
    expect(getSessionView('session-a')?.modelOverride).toEqual({ providerId: 'openai', modelId: 'model' });
    expect(useSessionRecordStore.getState().pending).toEqual({});
  },
);

describe('clearComposerModelChoice', () => {
  beforeEach(() => {
    persistInvoke.mockReset();
    useComposerModelDraftStore.getState().reset();
  });

  it('persists a null session override when a session exists', async () => {
    persistInvoke.mockResolvedValue(saved({ modelOverride: null }));
    const result = await clearComposerModelChoice('session-a', 'project-a');
    expect(result).toEqual({ ok: true, latest: true });
    expect(persistInvoke).toHaveBeenCalledWith('session-a', {
      modelOverride: null,
      clientRevision: expect.any(Number),
    });
  });

  it('clears the no-session draft and does not invoke IPC', async () => {
    writeComposerDraftModel('project-a', { providerId: 'openai', modelId: 'gpt-5.6-sol' });
    const result = await clearComposerModelChoice(null, 'project-a');
    expect(result).toEqual({ ok: true });
    expect(persistInvoke).not.toHaveBeenCalled();
    expect(readComposerDraftModel('project-a')).toBeNull();
  });
});
