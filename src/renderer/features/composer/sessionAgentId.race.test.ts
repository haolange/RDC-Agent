import { beforeEach, expect, it, vi } from 'vitest';
import { useLayoutStore } from '../../stores/layoutStore';
import { useProjectStore } from '../../stores/projectStore';
import type { SessionRecord } from '@shared/types/session';

/** A transport whose responses the test releases one by one, in any order. */
const pending = vi.hoisted(() => [] as Array<{ agentId: string; resolve: (value: unknown) => void }>);
vi.mock('../../platform/getElectronApi', () => ({
  getElectronApi: () => ({
    session: {
      setAgentId: (_sessionId: string, agentId: string) => new Promise((resolve) => pending.push({ agentId, resolve })),
    },
  }),
}));

import { persistSessionAgentId } from './sessionAgentId';

const session = (agentId: string): SessionRecord => ({
  schemaVersion: '1', sessionId: 'session-a', projectId: 'project-a', title: 'A', goal: '', sessionPath: '/a',
  createdAt: 1, updatedAt: 1, agentId,
});
const respond = (agentId: string) => {
  const request = pending.find((entry) => entry.agentId === agentId)!;
  request.resolve({ success: true, session: session(agentId) });
};

beforeEach(() => {
  pending.length = 0;
  useProjectStore.getState().setCurrentSession(session('general'));
  useProjectStore.getState().setSessions([session('general')]);
  useLayoutStore.getState().setSelectedAgentId('general');
});

/**
 * The person picks Debugger, then Analyzer; main answers Analyzer first and Debugger last. The visible Agent must end
 * on Analyzer, the latest intent. Today the late Debugger answer is applied over it and the pill bounces back. Known
 * defect until session facts carry a revision; `it.fails` reports when it is fixed.
 */
it.fails('keeps the latest Agent choice when an earlier switch is answered last', async () => {
  const first = persistSessionAgentId('session-a', 'debugger');
  const second = persistSessionAgentId('session-a', 'analyzer');
  respond('analyzer');
  await second;
  respond('debugger');
  await first;

  expect(useLayoutStore.getState().selectedAgentId).toBe('analyzer');
  expect(useProjectStore.getState().currentSession?.agentId).toBe('analyzer');
});
