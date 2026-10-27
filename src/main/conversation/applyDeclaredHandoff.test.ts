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
  compatibility: vi.fn(),
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
vi.mock('../sessions/handoffSkillCompatibility', () => ({ assertDeclaredHandoffSkillCompatibility: mocks.compatibility }));
vi.mock('../sessions/sessionPlanArtifact', () => ({ planArtifactWriter: { readMarkdown: () => ({ markdown: '# Approved plan' }) } }));

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
    mocks.offerRead.mockReturnValue({
      schemaVersion: '1', sourceAgentId: 'debugger', targetAgentId: 'general',
      plan: { uri: 'session://plans/plan-frozen.md', hash: 'a'.repeat(64) },
      requiredSkillIds: ['renderdoc-execution'], label: declared.label, prompt: declared.prompt,
      approvedAt: 1234,
    });
    mocks.planRead.mockReturnValue({
      status: 'approved',
      approvedHash: 'a'.repeat(64),
      frozenUri: 'session://plans/plan-frozen.md',
      approvedHandoff: { agent: 'general', label: declared.label },
      updatedAt: 1234,
    });
    mocks.resolveEnabled.mockImplementation((agentId: string) => (
      agentId === 'general'
        ? { id: 'general', handoffs: [] }
        : { id: 'debugger', handoffs: [declared] }
    ));
    mocks.dispatchHooks.mockResolvedValue(true);
  });

  it('persists the target agent while preserving the original approval time', async () => {
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
      approvedAt: 1234,
    }));
    expect(mocks.dispatchHooks).toHaveBeenCalledWith('agent.before-handoff', expect.any(Object));
    expect(mocks.dispatchHooks).toHaveBeenCalledWith('agent.after-handoff', expect.any(Object));
  });
  it('rejects changed preparation requirements after approval without rewriting the offer or session', async () => {
    mocks.resolveEnabled.mockImplementation((agentId: string) => agentId === 'general' ? { id: 'general', handoffs: [] }
      : { id: 'debugger', handoffs: [{ ...declared, requiredSkillIds: ['another-method'] }] });
    const result = await applyDeclaredHandoff({ sessionId: 'sess', agent: 'general', label: declared.label });
    expect(result).toMatchObject({ success: false, error: expect.stringContaining('EXECUTION_OFFER_CHANGED') });
    expect(mocks.offerWrite).not.toHaveBeenCalled(); expect(mocks.updateSession).not.toHaveBeenCalled();
  });

  it('keeps the same approval time when declaring the handoff again from General', async () => {
    mocks.readSession.mockReturnValue({ sessionId: 'sess', projectId: 'proj', agentId: 'general' });
    await applyDeclaredHandoff({ sessionId: 'sess', agent: 'general', label: declared.label });
    await applyDeclaredHandoff({ sessionId: 'sess', agent: 'general', label: declared.label });
    expect(mocks.offerWrite).toHaveBeenCalledTimes(2);
    for (const [, offer] of mocks.offerWrite.mock.calls) expect(offer.approvedAt).toBe(1234);
  });

  it.each([null, 9876])('uses the approved decision time even when the offer time is %s', async (offerTime) => {
    mocks.offerRead.mockReturnValue(offerTime === null ? null : { ...mocks.offerRead(), approvedAt: offerTime });
    const result = await applyDeclaredHandoff({ sessionId: 'sess', agent: 'general', label: declared.label });
    expect(result.success).toBe(true);
    expect(mocks.offerWrite).toHaveBeenCalledWith('sess', expect.objectContaining({ approvedAt: 1234 }));
  });

  it('does not create an approval from an unapproved plan', async () => {
    mocks.planRead.mockReturnValue({ status: 'rejected', updatedAt: 9876 });
    await applyDeclaredHandoff({ sessionId: 'sess', agent: 'general', label: declared.label });
    expect(mocks.offerWrite).not.toHaveBeenCalled();
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

  it('does not switch agents or write an offer when explicit preparation is incompatible', async () => {
    mocks.compatibility.mockImplementationOnce(() => { throw new Error('TASK_EXECUTION_REQUIREMENTS: comparison-method missing'); });
    const result = await applyDeclaredHandoff({ sessionId: 'sess', agent: 'general', label: declared.label });
    expect(result).toMatchObject({ success: false, error: expect.stringContaining('comparison-method') });
    expect(mocks.updateSession).not.toHaveBeenCalled();
    expect(mocks.offerWrite).not.toHaveBeenCalled();
    expect(mocks.dispatchHooks).not.toHaveBeenCalled();
  });
  it('rejects a different target than the approved action without changing approval time', async () => {
    mocks.planRead.mockReturnValue({ status: 'approved', approvedHash: 'a'.repeat(64), frozenUri: 'session://plans/plan.md', approvedHandoff: { agent: 'optimizer', label: 'Different' }, updatedAt: 1234 });
    expect((await applyDeclaredHandoff({ sessionId: 'sess', agent: 'general', label: declared.label })).error).toContain('TARGET_MISMATCH');
    expect(mocks.updateSession).not.toHaveBeenCalled();
    expect(mocks.offerWrite).not.toHaveBeenCalled();
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
      approvedAt: 1234,
    });
    expect(suggestion?.send).toBe(true);
    expect(mocks.offerWrite).toHaveBeenCalledWith('sess', expect.objectContaining({
      requiredSkillIds: ['renderdoc-execution'],
      targetAgentId: 'general',
      approvedAt: 1234,
    }));
  });
});
