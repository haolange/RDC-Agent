import { beforeEach, expect, it } from 'vitest';
import { getSessionView, useSessionRecordStore } from './sessionRecordStore';
import type { SessionRecord } from '@shared/types/session';

const record = (title: string): SessionRecord => ({
  schemaVersion: '1',
  sessionId: 's',
  projectId: 'p',
  title,
  goal: '',
  sessionPath: '/s',
  createdAt: 1,
  updatedAt: 1,
});

beforeEach(() => useSessionRecordStore.getState().reset());

it('keeps the newest revision: a larger count within a run, and any record from a restarted main process', () => {
  const store = useSessionRecordStore.getState();
  expect(store.accept({ record: record('fifth'), revision: { epoch: 'run-1', n: 5 } })).toBe(true);
  expect(store.accept({ record: record('third'), revision: { epoch: 'run-1', n: 3 } })).toBe(false);
  expect(store.accept({ record: record('fifth again'), revision: { epoch: 'run-1', n: 5 } })).toBe(false);
  expect(getSessionView('s')?.title).toBe('fifth');
  expect(store.accept({ record: record('restarted'), revision: { epoch: 'run-2', n: 1 } })).toBe(true);
  expect(getSessionView('s')?.title).toBe('restarted');
});

it('lays the latest pending intent over the record and keeps the view identity while nothing changes', () => {
  const store = useSessionRecordStore.getState();
  store.accept({ record: record('a'), revision: { epoch: 'run-1', n: 1 } });
  const first = store.beginIntent('s', { agentId: 'debugger' });
  const second = store.beginIntent('s', { agentId: 'analyzer' });
  const view = getSessionView('s');
  expect(view?.agentId).toBe('analyzer');
  store.settleIntent('s', first);
  expect(getSessionView('s')).toBe(view);
  store.settleIntent('s', second);
  expect(getSessionView('s')?.agentId).toBeUndefined();
});
