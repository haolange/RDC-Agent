import { expect, it, vi } from 'vitest';
const artifacts = vi.hoisted(() => ({ contents: [] as string[] }));
vi.mock('electron', () => ({ app: { getPath: () => process.env.TEMP, getAppPath: () => process.cwd() } }));
vi.mock('../../settings/SettingsService', () => ({ settingsService: { getAll: () => ({ paths: {}, llm: { providers: [], agentRoutes: [] } }) } }));
vi.mock('../../settings/AgentManifestService', () => ({ agentManifestService: { getEffectiveProfiles: () => [{ id: 'general', enabled: true, instructions: 'General', tools: [], skills: [], mcpServers: [], handoffs: [], agents: ['general'] }] } }));
vi.mock('../../agent-runtime/tasks/sessionTaskStore', () => ({ createSessionTaskStore: () => store }));
vi.mock('../../sessions/SessionArtifactResolver', () => ({ sessionArtifactResolver: { write: (_session: string, uri: string, content: string | Buffer) => { artifacts.contents.push(String(content)); return { uri, hash: 'a'.repeat(64) }; }, read: () => ({ hash: 'a'.repeat(64) }) } }));
import { grantDelegatedArtifactAccess } from '../../sessions/DelegatedArtifactAccess';
import { registerDelegatedTaskScope } from '../../agent-runtime/tasks/DelegatedTaskScopes';
import { MemoryTaskStore } from '../../agent-runtime/tasks/TaskStore';
import { TaskRegistry } from '../../agent-runtime/tasks/TaskRegistry';
import { AgentToolApprovalRequestService } from '../../agent-runtime/permissions/AgentToolApprovalRequestService';
import { SubagentRunner } from './SubagentRunner';
import { createBackgroundSubagentService } from './BackgroundSubagentService';
import { TurnHandle, createPolicyBudgetState } from './TurnCoordinator';
import { bindTaskRootBudget } from './TaskRootBudget';
import type { AgentEvent } from '@shared/types/agentRuntime';
const store = new MemoryTaskStore();
it('canonical background dispatch projects the child approval after parent reply and enforces owner-scoped answer', async () => {
 const approvals = new AgentToolApprovalRequestService();
 const events: AgentEvent[] = [];
 let release!: () => void;
 const gate = new Promise<void>((resolve) => { release = resolve; });
 const runner = new SubagentRunner({ getActiveTurn: () => null, systemPromptForAgent: () => 'General', sendProfileMessage: async (_agent, _text, options) => {
  await gate;
  const approved = await approvals.request({ agentId: 'general', sessionId: options!.sessionId, turnId: 'child-turn', toolCallId: 'mutation', toolName: 'shell', reason: 'bounded write', risk: 'high', context: { sessionId: options!.sessionId, turnId: 'child-turn' }, signal: options?.signal, onEvent: options?.onEvent });
  expect(approved).toBe(true);
  return 'approved';
 } });
 const service = createBackgroundSubagentService(runner);
 runner.setBackgroundStarter((input) => service.start(input));
 const task = await new TaskRegistry(store).createTask('approval execution');
 const parent = new TurnHandle({ sessionKey: 'owner', turnId: 'parent-turn', generation: 1 });
 parent.runtimePlan = { profileDelegates: ['general'] } as never;
 parent.eventSink = { sessionId: 'owner', onEvent: (event: AgentEvent) => {
  events.push(event);
  if (event.type === 'approval.requested') {
   expect(approvals.answer({ sessionId: 'unrelated', turnId: 'child-turn', approvalId: 'tool-approval-mutation', approved: true }).success).toBe(false);
   expect(approvals.answer({ sessionId: 'owner', turnId: 'child-turn', approvalId: 'tool-approval-mutation', approved: true }).success).toBe(true);
  }
 } } as never;
 const tool = runner.createSubagentTools('general', 'owner', parent)[0]!;
 const start = await tool.execute('dispatch', { mode: 'background', taskId: task.id, goal: 'check', task: 'check', scope: 'one write', acceptedFacts: [], hypotheses: [], challengeRefs: [], negativePaths: [], inputArtifactRefs: [], requiredSkillIds: [], stopConditions: ['done'], outputRequirements: 'result', budget: { maxToolCalls: 3, maxWallTimeMs: 10000 } });
 const executionId = (start.details as { executionId: string }).executionId;
 expect(executionId).toBeTruthy();
 parent.close(); release();
 await service.join(executionId);
 expect(events.find((event) => event.type === 'approval.requested')).toMatchObject({ sessionId: 'owner', payload: { delegatedRequest: { executionId, turnId: 'child-turn' } } });
 expect((await service.query('owner', executionId))?.status).toBe('partial');
});

it('keeps the immediate parent artifact allowlist when a nested background task uses the durable root store', async () => {
 let providerCalls = 0;
 const runner = new SubagentRunner({ getActiveTurn: () => null, systemPromptForAgent: () => 'General', sendProfileMessage: async () => { providerCalls += 1; return 'unexpected'; } });
 const service = createBackgroundSubagentService(runner); runner.setBackgroundStarter((input) => service.start(input));
 const registry = new TaskRegistry(store); const root = await registry.createTask('delegated scope'); const childTask = await registry.createTask('nested work', { parentTaskId: root.id });
 const origin = 'owner::subagent::first';
 const releaseTask = registerDelegatedTaskScope(origin, { ownerSessionId: 'owner', rootTaskId: root.id });
 const releaseArtifacts = grantDelegatedArtifactAccess(origin, 'owner', ['session://tool-outputs/allowed.txt']);
 const parent = new TurnHandle({ sessionKey: origin, turnId: 'nested-parent', generation: 1 }); parent.runtimePlan = { profileDelegates: ['general'] } as never;
 try {
  const tool = runner.createSubagentTools('general', origin, parent)[0]!;
  const result = await tool.execute('nested-start', { mode: 'background', taskId: childTask.id, goal: 'check', task: 'check', scope: 'subtree', acceptedFacts: [], hypotheses: [], challengeRefs: [], negativePaths: [], inputArtifactRefs: ['session://tool-outputs/secret.txt'], requiredSkillIds: [], stopConditions: ['done'], outputRequirements: 'result', budget: { maxToolCalls: 3, maxWallTimeMs: 10000 } });
  const executionId = (result.details as { executionId: string }).executionId; expect(executionId).toBeTruthy();
  await service.join(executionId); expect(providerCalls).toBe(0);
  expect((await service.query('owner', executionId))?.status).toBe('failed');
  expect(artifacts.contents.some((content) => JSON.parse(content).chunks.join('').includes('nested delegation exceeds granted refs'))).toBe(true);
 } finally { parent.close(); releaseArtifacts(); releaseTask(); }
});

it('restores the previous Task execution root before binding a fresh parent request for background retry', async () => {
 const registry = new TaskRegistry(store);
 const task = await registry.createTask('retry after restart');
 const original = createPolicyBudgetState({ maxToolCalls: 40, maxSubagents: 5, maxChildDepth: 3, maxWallTimeMs: 600000 });
 original.toolCalls = 7;
 const rootId = await bindTaskRootBudget(registry, 'retry-owner', original);
 const old = await registry.startExecution(task.id, { mode: 'direct', rootBudgetId: rootId });
 await registry.settleExecution(old.id, { status: 'blocked', expectedGeneration: old.generation, result: { disposition: 'blocked', summary: 'requires retry', outputs: {}, evidenceRefs: [], counterevidence: [], unresolved: ['retry'], scope: 'fixture', sideEffects: [], recoveryState: [] } });
 const runner = new SubagentRunner({ getActiveTurn: () => null, systemPromptForAgent: () => 'General', sendProfileMessage: async () => 'bounded result' });
 const service = createBackgroundSubagentService(runner); runner.setBackgroundStarter(input => service.start(input));
 const live = createPolicyBudgetState({ maxToolCalls: 40, maxSubagents: 5, maxChildDepth: 3, maxWallTimeMs: 600000 });
 live.toolCalls = 2;
 const parent = new TurnHandle({ sessionKey: 'retry-owner', turnId: 'resumed-turn', generation: 1, policyBudget: live });
 parent.runtimePlan = { profileDelegates: ['general'] } as never;
 const result = await runner.createSubagentTools('general', 'retry-owner', parent)[0]!.execute('retry', { mode: 'background', taskId: task.id, goal: 'check', task: 'check', scope: 'one source', acceptedFacts: [], hypotheses: [], challengeRefs: [], negativePaths: [], inputArtifactRefs: [], requiredSkillIds: [], stopConditions: ['done'], outputRequirements: 'result', budget: { maxToolCalls: 3, maxWallTimeMs: 10000 } });
 const id = (result.details as { executionId: string }).executionId;
 expect(id).toBeTruthy(); await service.join(id);
 expect((await registry.getExecution(id))?.rootBudgetId).toBe(rootId);
 expect(live.toolCalls).toBeGreaterThanOrEqual(9);
 expect(live.wallStartedAt).toBe(original.wallStartedAt);
 expect((await registry.getExecution(old.id))?.status).toBe('blocked');
});
