import { beforeEach, expect, it, vi } from 'vitest';

/** One session's durable state, held in memory so each test can read what a rollback restored. */
const disk = vi.hoisted(() => ({
  session: null as SessionRecord | null,
  offer: null as ExecutionOffer | null,
  state: null as PlanReviewStateDocument | null,
  frozen: new Map<string, string>(),
  failOfferWrite: false,
  hooks: vi.fn(async (_event: string) => true),
  model: vi.fn(async () => undefined),
  profiles: vi.fn(),
}));
vi.mock('../../sessions/store/sessionStores', async () => {
  const { sessionRevisions } = await import('../../sessions/store/SessionRevisionRegistry');
  return {
    sessionRecordStore: {
      readSession: () => disk.session,
      updateSession: (_id: string, patch: Partial<SessionRecord>) => {
        disk.session = { ...disk.session!, ...patch, updatedAt: disk.session!.updatedAt + 1 };
        sessionRevisions.written(disk.session);
        return disk.session;
      },
    },
    projectWorkspaceStore: { getProjectById: () => ({ rootPath: '/project' }) },
    executionOfferStore: {
      read: () => disk.offer,
      write: (_id: string, offer: ExecutionOffer) => {
        if (disk.failOfferWrite) throw new Error('disk full');
        disk.offer = structuredClone(offer);
      },
      clear: () => { disk.offer = null; },
    },
  };
});
vi.mock('../../hooks/runtimeHookDispatch', () => ({ dispatchRuntimeHooks: disk.hooks }));
vi.mock('./sessionModelGate', () => ({ assertSessionModelAndControls: disk.model }));
vi.mock('../../settings/agent-manifests/effectiveAgentSnapshot', () => ({ resolveEnabledAgentDefinition: disk.profiles }));
vi.mock('./handoffSkillCompatibility', () => ({ assertDeclaredHandoffSkillCompatibility: vi.fn() }));

import { sessionRevisions } from '../../sessions/store/SessionRevisionRegistry';
import { runPlanApprovalTransaction, type PlanApprovalDeps, type PlanApprovalInput } from './PlanApprovalTransaction';
import type { ExecutionOffer } from '../../sessions/run/executionOffer';
import type { ConversationPlanReview } from '@shared/types/planReview';
import type { PlanReviewStateDocument } from '../../sessions/run/PlanReviewStateStore';
import type { SessionRecord } from '@shared/types/session';

const hash = 'a'.repeat(64);
const planReview: ConversationPlanReview = {
  planId: 'plan-1', revision: 2, uri: 'session://plans/plan.md', hash, title: 'Find the drop', summary: [], sections: [],
  status: 'awaiting', handoffOptions: [{ agent: 'general', label: 'Execute with General' }],
};
const declared = { agent: 'general', label: 'Execute with General', prompt: 'Execute the frozen plan.', send: true,
  requiredSkillIds: ['renderdoc-execution'] };
const awaiting: PlanReviewStateDocument = { schemaVersion: '1', planId: 'plan-1', ownerTurnId: 'turn-1', revision: 2,
  status: 'awaiting', updatedAt: 100 };
const priorOffer: ExecutionOffer = { schemaVersion: '1', sourceAgentId: 'debugger', targetAgentId: 'general',
  plan: { uri: 'session://plans/plan-old.md', hash: 'b'.repeat(64) }, requiredSkillIds: [], label: 'Execute with General',
  prompt: 'Earlier plan.', approvedAt: 50 };

function deps(overrides: Partial<PlanApprovalDeps> = {}): PlanApprovalDeps & { diagnostics: string[] } {
  const diagnostics: string[] = [];
  return {
    diagnostics,
    writer: {
      stageFrozenPlan: (_id, expected) => ({ uri: 'session://plans/plan-frozen.md', markdown: '# Find the drop', hash: expected, taskRequirements: [] }),
      writeFrozenPlan: (_id, staged) => { disk.frozen.set(staged.uri, staged.markdown); },
      discardFrozenPlan: (_id, uri) => { disk.frozen.delete(uri); },
    },
    store: {
      assertAwaiting: () => {
        if (disk.state?.status !== 'awaiting') throw new Error('PLAN_REVIEW_SCOPE_CHANGED: this review no longer owns the current plan.');
        return disk.state;
      },
      replace: (_id, document) => { disk.state = structuredClone(document); },
    },
    installTaskRevisions: vi.fn(async () => undefined),
    isCurrent: () => true,
    onDiagnostic: (message) => diagnostics.push(message),
    ...overrides,
  };
}

function input(patch: Partial<PlanApprovalInput> = {}): PlanApprovalInput {
  return {
    sessionId: 'sess', turnId: 'turn-1', sourceAgentId: 'debugger', planReview,
    handoff: { agent: 'general', label: 'Execute with General' }, expectedPlanHash: hash,
    model: { providerId: 'p', modelId: 'm' }, controls: { reasoningLevel: 'high', fastModel: false, maxContextMode: false },
    baseRevision: sessionRevisions.revisionOf('sess'),
    ...patch,
  };
}

function expectNothingCommitted() {
  expect(disk.session?.agentId).toBe('debugger');
  expect(disk.session?.modelOverride).toBeUndefined();
  expect(disk.state).toEqual(awaiting);
  expect(disk.offer).toEqual(priorOffer);
  expect(disk.frozen.size).toBe(0);
}

beforeEach(() => {
  vi.clearAllMocks();
  disk.session = { schemaVersion: '1', sessionId: 'sess', projectId: 'proj', title: 'S', goal: '', sessionPath: '/s',
    createdAt: 1, updatedAt: 1, agentId: 'debugger' };
  sessionRevisions.written(disk.session);
  disk.offer = structuredClone(priorOffer);
  disk.state = structuredClone(awaiting);
  disk.frozen.clear();
  disk.failOfferWrite = false;
  disk.hooks.mockResolvedValue(true);
  disk.model.mockResolvedValue(undefined);
  disk.profiles.mockImplementation((agentId: string) => (agentId === 'debugger' ? { id: 'debugger', handoffs: [declared] } : { id: agentId, skills: [] }));
});

it('commits the frozen plan, plan state, offer and the session Agent, model and controls together', async () => {
  const result = await runPlanApprovalTransaction(input(), deps());

  expect(disk.frozen.get('session://plans/plan-frozen.md')).toBe('# Find the drop');
  expect(disk.state).toMatchObject({ status: 'approved', approvedHash: hash, frozenUri: 'session://plans/plan-frozen.md',
    approvedHandoff: { agent: 'general', label: 'Execute with General' } });
  expect(disk.offer).toMatchObject({ sourceAgentId: 'debugger', targetAgentId: 'general', requiredSkillIds: ['renderdoc-execution'],
    plan: { uri: 'session://plans/plan-frozen.md', hash }, approvedAt: disk.state!.updatedAt });
  expect(disk.session).toMatchObject({ agentId: 'general', modelOverride: { providerId: 'p', modelId: 'm' },
    turnControls: { reasoningLevel: 'high', fastModel: false, maxContextMode: false } });
  expect(result.session).toEqual({ record: disk.session, revision: sessionRevisions.revisionOf('sess') });
  expect(result.handoff).toMatchObject({ prompt: 'Execute the frozen plan.', send: true });
  expect(disk.hooks.mock.calls.map(([event]) => event)).toEqual(['agent.before-handoff', 'agent.after-handoff']);
  // The declaration is looked up once, on the planning profile.
  expect(disk.profiles.mock.calls.filter(([agentId]) => agentId === 'debugger')).toHaveLength(1);
});

it('leaves the session and plan untouched when agent.before-handoff vetoes', async () => {
  disk.hooks.mockResolvedValueOnce(false);
  await expect(runPlanApprovalTransaction(input(), deps())).rejects.toMatchObject({ code: 'HOOK_DENIED' });
  expectNothingCommitted();
});

it('rolls every committed step back when a later step fails', async () => {
  disk.failOfferWrite = true;
  await expect(runPlanApprovalTransaction(input(), deps())).rejects.toThrow('disk full');
  expectNothingCommitted();
  expect(disk.hooks.mock.calls.map(([event]) => event)).toEqual(['agent.before-handoff']);
});

it('keeps a committed approval and reports a diagnostic when agent.after-handoff fails', async () => {
  disk.hooks.mockImplementation(async (event: string) => {
    if (event === 'agent.after-handoff') throw new Error('hook crashed');
    return true;
  });
  const dependencies = deps();
  await expect(runPlanApprovalTransaction(input(), dependencies)).resolves.toMatchObject({ handoff: { send: true } });
  expect(disk.session?.agentId).toBe('general');
  expect(disk.state?.status).toBe('approved');
  expect(dependencies.diagnostics).toEqual(['agent.after-handoff failed: hook crashed']);
});

it.each([
  ['a stale plan hash', () => input({ expectedPlanHash: 'c'.repeat(64) }), 'PLAN_HASH_MISMATCH'],
  ['a stale session revision', () => input({ baseRevision: { ...sessionRevisions.revisionOf('sess'), n: 0 } }), 'SESSION_REVISION_STALE'],
  ['a revision from an earlier main process', () => input({ baseRevision: { epoch: 'earlier-run', n: sessionRevisions.revisionOf('sess').n } }), 'SESSION_REVISION_STALE'],
])('rejects %s before any effect', async (_name, build, code) => {
  await expect(runPlanApprovalTransaction(build(), deps())).rejects.toMatchObject({ code });
  expectNothingCommitted();
  expect(disk.hooks).not.toHaveBeenCalled();
});

it('does not commit an approval whose review was cancelled while the hooks ran', async () => {
  await expect(runPlanApprovalTransaction(input(), deps({ isCurrent: () => false }))).rejects.toMatchObject({ code: 'PLAN_REVIEW_SCOPE_CHANGED' });
  expectNothingCommitted();
});
