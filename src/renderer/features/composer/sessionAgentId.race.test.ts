import { beforeEach, expect, it, vi } from 'vitest';
import { AppError } from '@shared/errors/appError';
import { useProjectStore } from '../../stores/projectStore';
import { getSessionView, useSessionRecordStore } from '../../stores/sessionRecordStore';

/**
 * A transport whose responses the test releases one by one, in any order. Main handles the writes in the order they
 * arrive, so each answer carries the revision of its own write.
 */
const pending = vi.hoisted(
  () =>
    [] as Array<{ agentId: string; n: number; resolve: (value: unknown) => void; reject: (reason: unknown) => void }>,
);
vi.mock('../../platform/getElectronApi', () => ({
  getElectronApi: () => ({
    session: {
      setAgentId: (_sessionId: string, agentId: string) =>
        new Promise((resolve, reject) => {
          pending.push({ agentId, n: pending.length + 2, resolve, reject });
        }),
    },
  }),
}));

import { persistSessionAgentId } from './sessionAgentId';
import type { SessionRecord } from '@shared/types/session';

const session = (agentId: string): SessionRecord => ({
  sessionId: 'session-a',
  projectId: 'project-a',
  title: 'A',
  goal: '',
  sessionPath: '/a',
  createdAt: 1,
  updatedAt: 1,
  agentId,
});
const request = (agentId: string) => pending.find((entry) => entry.agentId === agentId)!;
const respond = (agentId: string) => {
  const entry = request(agentId);
  entry.resolve({ success: true, session: { record: session(agentId), revision: { epoch: 'run-1', n: entry.n } } });
};

beforeEach(() => {
  pending.length = 0;
  useSessionRecordStore.getState().reset();
  useSessionRecordStore.getState().accept({ record: session('general'), revision: { epoch: 'run-1', n: 1 } });
  useProjectStore.setState({ currentSessionId: 'session-a' });
});

/**
 * The person picks Debugger, then Analyzer; main answers Analyzer first and Debugger last. The visible Agent stays on
 * Analyzer, the latest intent, at every step: the late Debugger answer carries an older revision and is not applied.
 */
it('keeps the latest Agent choice when an earlier switch is answered last', async () => {
  const first = persistSessionAgentId('session-a', 'debugger');
  const second = persistSessionAgentId('session-a', 'analyzer');
  expect(getSessionView('session-a')?.agentId).toBe('analyzer');
  respond('analyzer');
  await second;
  expect(getSessionView('session-a')?.agentId).toBe('analyzer');
  respond('debugger');
  await first;

  expect(getSessionView('session-a')?.agentId).toBe('analyzer');
  expect(useSessionRecordStore.getState().records['session-a']?.revision.n).toBe(3);
});

it('returns to the Agent main holds when a switch fails', async () => {
  const switching = persistSessionAgentId('session-a', 'debugger');
  expect(getSessionView('session-a')?.agentId).toBe('debugger');
  request('debugger').reject(new AppError('CONVERSATION_AGENT_UNAVAILABLE', 'debugger'));
  await expect(switching).resolves.toMatchObject({ ok: false });

  expect(getSessionView('session-a')?.agentId).toBe('general');
});
