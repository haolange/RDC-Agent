import { beforeEach, describe, expect, it } from 'vitest';
import type { AgentRunPresentation } from '@shared/types/agenticTrace';
import { useWorkflowStore } from './workflowStore';

const rightPanel = {
  progress: [],
  artifacts: { rows: [], supersededCount: 0, truncatedCount: 0, storeDegraded: false },
  outputs: { current: [], previous: [] },
  context: {
    task: { projectId: 'p', projectName: 'p', sessionId: 's', sessionTitle: 's', workingDirectory: '.', configurationPhase: 'current_turn', agentProfile: 'general', permission: 'default', resources: [] },
    rdc: { capture: null, availableCaptures: [], runtime: {}, diagnostics: [] },
  },
} as AgentRunPresentation['rightPanel'];

const presentation = (overrides: Partial<AgentRunPresentation> = {}): AgentRunPresentation => ({
  projectId: 'p',
  sessionId: 's',
  activeBranchId: 'main',
  profileId: 'default',
  updatedAt: '2026-01-01T00:00:00.000Z',
  runs: [],
  rightPanel,
  rawAuditRefs: [],
  ...overrides,
});

describe('workflowStore', () => {
  beforeEach(() => {
    useWorkflowStore.getState().reset();
  });

  it('skips identical session/updatedAt/rightPanel trace writes', () => {
    const first = presentation();
    useWorkflowStore.getState().setTracePresentation(first);
    const afterFirst = useWorkflowStore.getState().tracePresentation;
    useWorkflowStore.getState().setTracePresentation({ ...first, runs: [] });
    expect(useWorkflowStore.getState().tracePresentation).toBe(afterFirst);
  });

  it('accepts a newer updatedAt or a replaced right panel', () => {
    useWorkflowStore.getState().setTracePresentation(presentation());
    const next = presentation({
      updatedAt: '2026-01-01T00:00:01.000Z',
      rightPanel: { ...rightPanel, progress: [] },
    });
    useWorkflowStore.getState().setTracePresentation(next);
    expect(useWorkflowStore.getState().tracePresentation).toBe(next);
  });
});
