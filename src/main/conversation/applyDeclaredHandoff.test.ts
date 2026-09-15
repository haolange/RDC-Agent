import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  readSession: vi.fn(),
  getProjectById: vi.fn(),
  updateSession: vi.fn(),
  offerWrite: vi.fn(),
  offerRead: vi.fn(),
  planRead: vi.fn(),
  resolveEnabled: vi.fn(),
  dispatchHooks: vi.fn(async () => true),
}));

vi.mock('../sessions/StorageAdapter', () => ({
  storageAdapter: {
    readSession: mocks.readSession,
    getProjectById: mocks.getProjectById,
    updateSession: mocks.updateSession,
    executionOffers: {
      write: mocks.offerWrite,
      read: mocks.offerRead,
    },
  },
}));
vi.mock('../sessions/PlanReviewStateStore', () => ({
  planReviewStateStore: { read: mocks.planRead },
}));
vi.mock('./ConversationRoutePreflight', () => ({
  resolveEnabledAgentDefinition: mocks.resolveEnabled,
}));
vi.mock('../hooks/runtimeHookDispatch', () => ({
  dispatchRuntimeHooks: mocks.dispatchHooks,
}));

import { applyDeclaredHandoff, writeExecutionOfferFromApproval } from './applyDeclaredHandoff';

const declared = {
  agent: 'general',
  label: 'Execute with General',
  prompt: 'Execute the frozen plan.',
  send: true,
  requiredSkillIds: ['renderdoc-execution'],
};

describe('applyDeclaredHandoff', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readSession.mockReturnValue({ sessionId: 'sess', projectId: 'proj', agentId: 'debugger' });
    mocks.getProjectById.mockReturnValue({ rootPath: 'D:/proj' });
    mocks.updateSession.mockImplementation((_id: string, patch: { agentId: string }) => ({
      sessionId: 'sess',
      projectId: 'proj',
      agentId: patch.agentId,
    }));
    mocks.offerRead.mockReturnValue(null);
    mocks.planRead.mockReturnValue({
      status: 'approved',
      approvedHash: 'a'.repeat(64),
      frozenUri: 'session://plans/plan-frozen.md',
    });
    mocks.resolveEnabled.mockImplementation((agentId: string) => (
      agentId === 'general'
        ? { id: 'general', handoffs: [] }
        : { id: 'debugger', handoffs: [declared] }
    ));
    mocks.dispatchHooks.mockResolvedValue(true);
  });

  it('persists the target agent and writes an offer from the approved plan', async () => {
    const result = await applyDeclaredHandoff({
      sessionId: 'sess',
      agent: 'general',
      label: 'Execute with General',
    });
    expect(result.success).toBe(true);
    expect(result.session?.agentId).toBe('general');
    expect(mocks.offerWrite).toHaveBeenCalledWith('sess', expect.objectContaining({
      sourceAgentId: 'debugger',
      targetAgentId: 'general',
      requiredSkillIds: ['renderdoc-execution'],
    }));
    expect(mocks.dispatchHooks).toHaveBeenCalledWith('agent.before-handoff', expect.any(Object));
    expect(mocks.dispatchHooks).toHaveBeenCalledWith('agent.after-handoff', expect.any(Object));
  });

  it('rejects an undeclared continue action', async () => {
    const result = await applyDeclaredHandoff({
      sessionId: 'sess',
      agent: 'optimizer',
      label: 'Nope',
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/DECLARED_HANDOFF_NOT_FOUND/);
    expect(mocks.updateSession).not.toHaveBeenCalled();
  });
});

describe('writeExecutionOfferFromApproval', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveEnabled.mockReturnValue({ id: 'debugger', handoffs: [declared] });
  });

  it('writes requiredSkillIds from the matching Mission declaration', () => {
    const suggestion = writeExecutionOfferFromApproval({
      sessionId: 'sess',
      sourceAgentId: 'debugger',
      projectRoot: null,
      handoff: { label: 'Execute with General', agent: 'general' },
      plan: { uri: 'session://plans/plan-frozen.md', hash: 'a'.repeat(64) },
    });
    expect(suggestion?.send).toBe(true);
    expect(mocks.offerWrite).toHaveBeenCalledWith('sess', expect.objectContaining({
      requiredSkillIds: ['renderdoc-execution'],
      targetAgentId: 'general',
    }));
  });
});
