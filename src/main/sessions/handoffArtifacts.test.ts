import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SessionArtifactResolver, sessionArtifactResolver } from './SessionArtifactResolver';
import { validateHandoffArtifacts } from './handoffArtifacts';
import { handoffRequiredSkillIds } from './handoffSkills';
import { handoffPromptSegments } from './handoffPrompt';
import { assertHandoffSkillCompatibility } from './handoffSkillCompatibility';
import { storageAdapter } from './StorageAdapter';
import { HandoffContractSchema } from '@shared/types/handoffContract';
import type { ProfileHandoffState } from '@shared/types/profileHandoff';
import { resolveRdxDelegation } from './RdxDelegation';
import { parseDelegationCapsule } from '@shared/types/delegationCapsule';

const roots: string[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-bound-plan-')); roots.push(root);
  for (const session of ['a', 'b']) fs.mkdirSync(path.join(root, session));
  const resolver = new SessionArtifactResolver({ resolveSessionPath: id => ['a', 'b'].includes(id) ? path.join(root, id) : null });
  vi.spyOn(sessionArtifactResolver, 'read').mockImplementation(resolver.read.bind(resolver));
  const plan = resolver.write('a', 'session://plans/plan.md', '# 调查计划\n事实、反例与分支');
  const contract = { intent: 'execute' as const, plan: { uri: plan.uri, hash: plan.hash }, requiredSkillIds: ['renderdoc-execution', 'debugger-causal-method', 'renderdoc-execution'], returnTo: 'debugger', deliveryRequirements: '当前 Checkpoint 与未解问题' };
  return { resolver, contract };
}

describe('bound plan and skill preparation', () => {
  it('rejects malformed, missing, changed and foreign-session plan references', () => {
    const { resolver, contract } = setup();
    expect(validateHandoffArtifacts('a', contract)).toEqual(contract);
    expect(() => validateHandoffArtifacts('b', contract)).toThrow(/NOT_FOUND/);
    expect(() => validateHandoffArtifacts('a', { ...contract, plan: { uri: '../escape', hash: contract.plan.hash } })).toThrow();
    resolver.write('a', contract.plan.uri, '# Changed strategy');
    expect(() => validateHandoffArtifacts('a', contract)).toThrow(/HASH_MISMATCH/);
    expect(() => HandoffContractSchema.parse({ ...contract, requiredSkillIds: [] })).toThrow();
    expect(() => HandoffContractSchema.parse({ ...contract, validationPolicy: 'skip' })).toThrow();
  });

  it('preloads and deduplicates bound methods without dollar references in the summary', () => {
    const { contract } = setup();
    const active: ProfileHandoffState = { handoffId: 'exec', lifecycle: 'committed', contract,
      sourceTurnId: 'source', sourceRequestId: 'request', sourceAgentId: 'debugger', toAgentId: 'general',
      chainRoot: 'root', depth: 2, prompt: '按附带计划执行，摘要故意不带任何 Skill 标记。', label: '执行', declaredModel: null, send: true, preparedAt: 1 };
    vi.spyOn(storageAdapter.handoffs, 'getActive').mockReturnValue(active);
    expect(handoffRequiredSkillIds('a', 'general')).toEqual(['renderdoc-execution', 'debugger-causal-method']);
    expect(handoffRequiredSkillIds('a', 'analyzer')).toEqual([]);
    expect(handoffPromptSegments('a', 'general')[0].content).toContain('"handoffId":"exec"');
    expect(handoffPromptSegments('a', 'analyzer')).toEqual([]);
    const binding = { handoffId: 'exec', returnTo: 'debugger', dispatchedAt: 1, validationPolicy: 'renderdoc-investigation', deliveryRequirements: 'checkpoint' };
    const compatible = { binding, agentId: 'general', tools: ['read', 'handoff'], intersection: null, deniedTools: [] };
    expect(() => assertHandoffSkillCompatibility(compatible)).not.toThrow();
    expect(() => assertHandoffSkillCompatibility({ ...compatible, intersection: ['read_file'] })).toThrow(/SKILL_CONFLICT/);
    expect(() => assertHandoffSkillCompatibility({ ...compatible, deniedTools: ['agent_handoff'] })).toThrow(/SKILL_CONFLICT/);
    expect(() => assertHandoffSkillCompatibility({ ...compatible, binding: null, tools: [] })).not.toThrow();
  });
});

describe('optional RDX delegation capability', () => {
  it('keeps ordinary capsules domain-free and freezes explicit requests', () => {
    const capsule = { mission: 'summarize', task: 'read notes', acceptedFacts: [], forbiddenPaths: [], inputArtifactRefs: [], outputRequirements: 'brief answer', budget: { maxToolCalls: 2, maxWallTimeMs: 1000 } };
    expect(parseDelegationCapsule(capsule).domainExtensions).toBeUndefined();
    expect(resolveRdxDelegation()).toEqual({ requiresLease: false, segments: [] });
    const delegated = parseDelegationCapsule({ ...capsule, domainExtensions: { rdx: { requiresLease: true } } });
    expect(Object.isFrozen(delegated.domainExtensions?.rdx)).toBe(true);
    expect(resolveRdxDelegation(delegated.domainExtensions).requiresLease).toBe(true);
    expect(() => resolveRdxDelegation({ rdx: { requiresLease: false } })).toThrow(/DENIED/);
    expect(() => resolveRdxDelegation({ unknown: { allow: true } })).toThrow(/DENIED/);
  });
});
