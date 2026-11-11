import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { SessionArtifactError } from '@shared/types/sessionArtifact';

vi.mock('electron', () => ({
  BrowserWindow: class { static getAllWindows() { return []; } },
  app: { getPath: () => process.env.TEMP ?? process.cwd(), getAppPath: () => process.cwd() },
}));
vi.mock('../../settings/settings-core/SettingsService', () => ({ settingsService: { getAll: () => ({
  agents: { definitions: [] }, paths: { userRdcRoot: 'C:/tmp/rdc-agent-test' }, llm: { providers: [], agentRoutes: [] },
}) } }));
vi.mock('../../settings/agent-manifests/AgentManifestService', () => ({ agentManifestService: {
  getEffectiveProfiles: () => [{ id: 'general', enabled: true, instructions: 'Review', tools: [], skills: [],
    mcpServers: [], handoffs: [], agents: ['general'], reasoningLevel: 'medium',
    compiledRoute: { providerId: 'chatgpt-account', modelId: 'gpt-6-luna' } }],
} }));

import { TaskRegistry } from '../tasks/TaskRegistry';
import { createSessionTaskStore } from '../tasks/sessionTaskStore';
import { storageAdapter } from '../../sessions/store/StorageAdapter';
import { sessionArtifactResolver } from '../../sessions/artifacts/SessionArtifactResolver';
import { delegatedArtifactReferences, resolveDelegatedArtifactRead } from '../../sessions/artifacts/DelegatedArtifactAccess';
import { investigationArtifactService } from '../../investigation/InvestigationArtifactService';
import { SubagentRunner } from './SubagentRunner';
import { createBackgroundSubagentService } from './BackgroundSubagentService';
import type { AgentProfileTurnOptions } from './orchestratorTypes';
import type { DelegationCapsule } from '@shared/types/delegationCapsule';

it.each(['wait', 'background'] as const)('returns the exact missing delegation source to the parent in %s mode', async (mode) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-missing-source-'));
  const originalUserData = process.env.RDC_AGENT_USER_DATA;
  process.env.RDC_AGENT_USER_DATA = root;
  try {
    const projectRoot = path.join(root, 'project'); fs.mkdirSync(projectRoot);
    const project = await storageAdapter.createProject(projectRoot);
    const sessionId = storageAdapter.createSession(project.projectId).sessionId;
    const source = sessionArtifactResolver.write(sessionId, 'session://tool-outputs/source.json', '{"value":1}');
    const missing = 'session://tool-outputs/missing.json';
    const sendProfileMessage = vi.fn(async () => 'must not start');
    const runner = new SubagentRunner({ sendProfileMessage, systemPromptForAgent: () => 'Review', getActiveTurn: () => null });
    const background = createBackgroundSubagentService(runner);
    runner.setBackgroundStarter(input => background.start(input));
    const registry = new TaskRegistry(createSessionTaskStore(sessionId));
    const task = await registry.createTask('Review source');
    const tool = runner.createSubagentTools('general', sessionId)[0]!;
    const request = { goal: 'Review source', task: 'Review', scope: 'fixture', acceptedFacts: [
      { statement: 'A source is available.', sourceRefs: [source.uri], qualification: 'Unverified.' },
    ], hypotheses: [], challengeRefs: [], negativePaths: [], inputArtifactRefs: [source.uri, missing], requiredSkillIds: [],
    stopConditions: [], outputRequirements: 'Review', budget: {}, taskId: task.id, profile: 'general', mode };
    const response = await tool.execute(`missing-${mode}`, request);
    let result;
    if (mode === 'background') {
      const executionId = (response.details as { executionId: string }).executionId;
      await background.join(executionId);
      result = (await background.query(sessionId, executionId))!.result;
      const read = background.createTools('general', sessionId).find(item => item.name === 'background_result')!;
      const delivered = await read.execute('read-background-result', { executionId });
      expect(JSON.parse((delivered.content[0] as { text: string }).text).result)
        .toMatchObject({ error: 'ARTIFACT_NOT_FOUND', summary: `ARTIFACT_NOT_FOUND: ${missing}` });
    } else {
      expect(response.isError).toBe(true);
      expect(response.details).toMatchObject({ errorCode: 'ARTIFACT_NOT_FOUND' });
      result = JSON.parse((response.content[0] as { text: string }).text);
    }
    expect(result).toMatchObject({ disposition: 'blocked', error: 'ARTIFACT_NOT_FOUND', summary: `ARTIFACT_NOT_FOUND: ${missing}` });
    expect(sendProfileMessage).not.toHaveBeenCalled();
  } finally {
    if (originalUserData === undefined) delete process.env.RDC_AGENT_USER_DATA;
    else process.env.RDC_AGENT_USER_DATA = originalUserData;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

it('does not promote a child exception into a trusted source-grant failure', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-child-source-error-'));
  const originalUserData = process.env.RDC_AGENT_USER_DATA;
  process.env.RDC_AGENT_USER_DATA = root;
  try {
    const projectRoot = path.join(root, 'project'); fs.mkdirSync(projectRoot);
    const project = await storageAdapter.createProject(projectRoot);
    const sessionId = storageAdapter.createSession(project.projectId).sessionId;
    const source = sessionArtifactResolver.write(sessionId, 'session://tool-outputs/source.json', '{"value":1}');
    const sendProfileMessage = vi.fn(async () => { throw new SessionArtifactError('ARTIFACT_NOT_FOUND', 'child-private-text'); });
    const runner = new SubagentRunner({ sendProfileMessage, systemPromptForAgent: () => 'Review', getActiveTurn: () => null });
    const response = await runner.createSubagentTools('general', sessionId)[0]!.execute('child-error', {
      goal: 'Review', task: 'Review', scope: 'fixture', acceptedFacts: [], hypotheses: [], challengeRefs: [], negativePaths: [],
      inputArtifactRefs: [source.uri], requiredSkillIds: [], stopConditions: [], outputRequirements: 'Review', budget: {}, profile: 'general',
    });
    expect(sendProfileMessage).toHaveBeenCalledOnce();
    const result = JSON.parse((response.content[0] as { text: string }).text);
    expect(result).toMatchObject({ disposition: 'blocked', error: 'SUBAGENT_EXECUTION_FAILED' });
    expect(JSON.stringify(result)).not.toContain('child-private-text');
  } finally {
    if (originalUserData === undefined) delete process.env.RDC_AGENT_USER_DATA;
    else process.env.RDC_AGENT_USER_DATA = originalUserData;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

it.each([
  { mode: 'wait', firstDisposition: 'partial' },
  { mode: 'wait', firstDisposition: 'completed' },
  { mode: 'background', firstDisposition: 'completed' },
] as const)('continues a $firstDisposition independent review with new raw evidence in $mode mode', async ({ mode, firstDisposition }) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-source-continuation-'));
  const originalUserData = process.env.RDC_AGENT_USER_DATA;
  process.env.RDC_AGENT_USER_DATA = root;
  try {
    const projectRoot = path.join(root, 'project');
    fs.mkdirSync(projectRoot);
    const project = await storageAdapter.createProject(projectRoot);
    const sessionId = storageAdapter.createSession(project.projectId).sessionId;
    const source = sessionArtifactResolver.write(sessionId, 'session://tool-outputs/findings.json', '{"finding":"compare the data"}');
    const raw = sessionArtifactResolver.write(sessionId, 'session://tool-outputs/measurements.json', '{"samples":[3,5,7]}');
    const registry = new TaskRegistry(createSessionTaskStore(sessionId));
    const generator = await registry.createTask('Produce findings');
    const review = await registry.createTask('Review findings', { blockedBy: [generator.id],
      completionRequirements: ['review'], executionRequirements: { mode: 'subagent', requiredSkillIds: [], independentOfTaskIds: [generator.id] } });
    const generation = await registry.startExecution(generator.id, { mode: 'direct', preparation: {
      sessionId, turnId: 'source-turn', runtimeFingerprint: 'a'.repeat(24), skills: [], inputArtifacts: [],
      selectedTurnCount: 0, requestsDomainCapability: false,
    } });
    await registry.settleExecution(generation.id, { expectedGeneration: generation.generation, status: 'completed', result: {
      disposition: 'completed', summary: 'Findings available', outputs: {}, resultRef: source.uri, resultHash: source.hash,
    } });

    const budgets: Array<{ toolCalls: number; maxToolCalls: number; deadlineAt: number }> = [];
    const sendProfileMessage = vi.fn(async (_profile: string, _content: string, options?: AgentProfileTurnOptions) => {
      const child = options!.sessionId!;
      const granted = delegatedArtifactReferences(child)!;
      const budget = options!.policyBudget!;
      expect(options!.modelOverride).toEqual({ providerId: 'chatgpt-account', modelId: 'gpt-6-luna' });
      expect(options!.turnControls).toMatchObject({ reasoningLevel: 'medium', fastModel: false, maxContextMode: false });
      budgets.push({ toolCalls: budget.toolCalls, maxToolCalls: budget.maxToolCalls,
        deadlineAt: budget.wallStartedAt + budget.maxWallTimeMs });
      await options!.onTaskPreparation!({ sessionId: child, turnId: 'review-turn', runtimeFingerprint: 'b'.repeat(24),
        capsuleHash: createHash('sha256').update(JSON.stringify(options!.frozenDelegationCapsule)).digest('hex'),
        skills: [], inputArtifacts: granted, selectedTurnCount: 0, requestsDomainCapability: false });
      expect(resolveDelegatedArtifactRead(child, source.uri, source.hash).sessionId).toBe(sessionId);
      expect(() => resolveDelegatedArtifactRead(child, raw.uri, 'f'.repeat(64))).toThrow('frozen delegation grant');
      const hasRaw = granted.some(item => item.uri === raw.uri);
      if (hasRaw) {
        const permitted = resolveDelegatedArtifactRead(child, raw.uri, raw.hash);
        expect(sessionArtifactResolver.read(permitted.sessionId, raw.uri, { expectedHash: permitted.expectedHash }).text)
          .toBe('{"samples":[3,5,7]}');
      } else {
        expect(() => resolveDelegatedArtifactRead(child, raw.uri, raw.hash)).toThrow('frozen delegation grant');
      }
      budget.toolCalls += 2;
      options!.onTerminalContext!({ messages: [], status: 'complete', selectedTurnCount: 0, filteredArtifactCount: 0,
        executionIdentity: {} as never, completionDeclaration: { disposition: hasRaw ? 'completed' : firstDisposition, evidenceRefs: [], result: {
          summary: hasRaw ? 'Raw source reviewed' : 'Raw source missing', outputs: hasRaw ? { review: 'Checked original samples.' }
            : firstDisposition === 'completed' ? { review: 'Bounded review; raw source missing.' } : {},
          counterevidence: [], unresolved: hasRaw ? [] : ['Raw measurements were not granted'], scope: 'fixture', sideEffects: [], recoveryState: [],
        } } });
      return hasRaw ? 'Checked original samples.' : 'Raw measurements were not granted.';
    });
    const runner = new SubagentRunner({ sendProfileMessage, systemPromptForAgent: () => 'Review', getActiveTurn: () => null });
    const background = createBackgroundSubagentService(runner);
    runner.setBackgroundStarter(input => background.start(input));
    const tool = runner.createSubagentTools('general', sessionId)[0]!;
    const capsule: DelegationCapsule = { goal: 'Review findings', task: 'Review', scope: 'fixture', acceptedFacts: [],
      hypotheses: [], challengeRefs: [], negativePaths: [], inputArtifactRefs: [source.uri], requiredSkillIds: [],
      stopConditions: [], outputRequirements: 'Review the raw source', budget: { maxToolCalls: 8, maxWallTimeMs: 60_000 } };

    const dispatch = async (id: string, inputArtifactRefs: string[], budget: DelegationCapsule['budget']) => {
      const response = await tool.execute(id, { ...capsule, inputArtifactRefs, taskId: review.id, profile: 'general', mode, budget } as never);
      if (mode === 'background') await background.join((response.details as { executionId: string }).executionId);
      return response;
    };
    await dispatch('review-first', [source.uri], capsule.budget);
    expect(sendProfileMessage.mock.calls[0]![1]).toContain(`Runtime-frozen artifact references (URI, SHA-256):\n${source.uri} ${source.hash}\n`);
    const first = (await registry.listExecutions(review.id))[0]!;
    expect(first).toMatchObject({ generation: 1, status: firstDisposition, budget: { toolCalls: 2, maxToolCalls: 8 },
      independentSources: [{ taskId: generator.id, executionId: generation.id, generation: generation.generation,
        resultRef: source.uri, resultHash: source.hash }] });
    if (firstDisposition === 'completed') {
      await expect(dispatch('review-unchanged', [source.uri], capsule.budget)).rejects.toThrow('Terminal task cannot start another execution');
      expect((await registry.listExecutions(review.id))).toHaveLength(1);
    }
    await dispatch('review-retry', [source.uri, raw.uri], { maxToolCalls: 12, maxWallTimeMs: 120_000 });
    expect(sendProfileMessage.mock.calls[1]![1]).toContain(`Runtime-frozen artifact references (URI, SHA-256):\n${source.uri} ${source.hash}\n${raw.uri} ${raw.hash}\n`);
    const executions = await registry.listExecutions(review.id);
    const second = executions.find(item => item.generation === 2)!;
    expect(second).toMatchObject({ taskId: review.id, generation: 2, status: 'completed',
      budget: { toolCalls: 4, maxToolCalls: 8, deadlineAt: first.budget.deadlineAt }, independentSources: first.independentSources });
    expect(budgets).toEqual([
      { toolCalls: 0, maxToolCalls: 8, deadlineAt: first.budget.deadlineAt },
      { toolCalls: 2, maxToolCalls: 8, deadlineAt: first.budget.deadlineAt },
    ]);
    expect((await registry.listExecutions(generator.id))).toHaveLength(1);
    expect(sendProfileMessage).toHaveBeenCalledTimes(2);
  } finally {
    if (originalUserData === undefined) delete process.env.RDC_AGENT_USER_DATA;
    else process.env.RDC_AGENT_USER_DATA = originalUserData;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

it('grants an independent review the evidence its granted records depend on', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-review-closure-'));
  const originalUserData = process.env.RDC_AGENT_USER_DATA;
  process.env.RDC_AGENT_USER_DATA = root;
  const readAll = vi.spyOn(investigationArtifactService, 'readAllRecords');
  try {
    const projectRoot = path.join(root, 'project'); fs.mkdirSync(projectRoot);
    const project = await storageAdapter.createProject(projectRoot);
    const sessionId = storageAdapter.createSession(project.projectId).sessionId;
    const source = sessionArtifactResolver.write(sessionId, 'session://tool-outputs/findings.json', '{"finding":"anchor"}');
    const claim = sessionArtifactResolver.write(sessionId, 'session://investigation/claim-anchor.json', '{"claimId":"anchor"}');
    const evidence = sessionArtifactResolver.write(sessionId, 'session://investigation/ev-anchor.json', '{"evidenceId":"ev-anchor"}');
    const raw = sessionArtifactResolver.write(sessionId, 'session://tool-outputs/history.json', '{"history":[]}');
    readAll.mockReturnValue([
      { contentUri: claim.uri, contentHash: claim.hash, manifest: { kind: 'claim', status: 'ready' },
        record: { claimId: 'anchor', worldStateId: 'ws-none', experimentId: null, compactProvenance: null } },
      { contentUri: evidence.uri, contentHash: evidence.hash, manifest: { kind: 'evidence', status: 'ready' },
        record: { evidenceId: 'ev-anchor', worldStateId: 'ws-none', claimIds: ['anchor'], artifactRefs: [{ uri: raw.uri, expectedHash: raw.hash }] } },
    ] as never);
    const registry = new TaskRegistry(createSessionTaskStore(sessionId));
    const generator = await registry.createTask('Produce findings');
    const review = await registry.createTask('Review findings', { blockedBy: [generator.id],
      completionRequirements: ['review'], executionRequirements: { mode: 'subagent', requiredSkillIds: [], independentOfTaskIds: [generator.id] } });
    const generation = await registry.startExecution(generator.id, { mode: 'direct', preparation: {
      sessionId, turnId: 'source-turn', runtimeFingerprint: 'a'.repeat(24), skills: [], inputArtifacts: [],
      selectedTurnCount: 0, requestsDomainCapability: false } });
    await registry.settleExecution(generation.id, { expectedGeneration: generation.generation, status: 'completed', result: {
      disposition: 'completed', summary: 'Findings available', outputs: {}, resultRef: source.uri, resultHash: source.hash } });
    let granted: Array<{ uri: string; hash: string }> = [];
    const sendProfileMessage = vi.fn(async (_profile: string, _content: string, options?: AgentProfileTurnOptions) => {
      granted = delegatedArtifactReferences(options!.sessionId!)!;
      return 'not reviewed';
    });
    const runner = new SubagentRunner({ sendProfileMessage, systemPromptForAgent: () => 'Review', getActiveTurn: () => null });
    await runner.createSubagentTools('general', sessionId)[0]!.execute('review-closure', {
      goal: 'Review findings', task: 'Review', scope: 'fixture', acceptedFacts: [], hypotheses: [], challengeRefs: [], negativePaths: [],
      inputArtifactRefs: [source.uri, claim.uri], requiredSkillIds: [], stopConditions: [], outputRequirements: 'Review',
      budget: {}, taskId: review.id, profile: 'general', mode: 'wait' } as never);
    expect(granted.map(ref => ref.uri)).toEqual([source.uri, claim.uri, evidence.uri, raw.uri]);
    expect(sendProfileMessage.mock.calls[0]![1]).toContain('Runtime evidence closure: 2 dependent record or raw artifact reference(s) were added');
  } finally {
    readAll.mockRestore();
    if (originalUserData === undefined) delete process.env.RDC_AGENT_USER_DATA;
    else process.env.RDC_AGENT_USER_DATA = originalUserData;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
