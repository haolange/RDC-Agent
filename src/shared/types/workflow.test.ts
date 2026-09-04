import { describe, expect, it } from 'vitest';
import type { WorkflowState } from './workflow';

describe('workflow types', () => {
  it('coordinationMode is turn_handoff', () => {
    const state: WorkflowState = {
      caseId: 'case-1',
      runId: 'run-1',
      sessionId: 'session-1',
      entryMode: 'cli',
      backend: 'local',
      orchestrationMode: 'multi_agent',
      coordinationMode: 'turn_handoff',
      blockers: [],
      lastUpdated: '2026-09-05T00:00:00.000Z',
    };
    expect(state.coordinationMode).toBe('turn_handoff');
  });
});
