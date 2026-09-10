import fs from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventStream } from '../agent-runtime/core/EventStream';
import type { ProviderStrategy } from '../agent-runtime/core/ProviderRegistry';
import type { AssistantMessage, AssistantMessageEvent, Message, Model, ToolResultMessage } from '../agent-runtime/core/types';
import { agentLoop } from '../agent-runtime/agent/AgentLoop';
import { createTestRequestPlan } from './createTestRequestPlan';
import { RuntimeToolAssembly } from '../workflow/debugger/RuntimeToolAssembly';
import { TurnHandle } from '../workflow/debugger/TurnCoordinator';
import { HandoffStateStore } from '../sessions/HandoffStateStore';
import { StorageIo } from '../sessions/StorageIo';
import { storageAdapter } from '../sessions/StorageAdapter';
import { sessionArtifactResolver } from '../sessions/SessionArtifactResolver';
import { investigationArtifactService } from '../investigation/InvestigationArtifactService';
import { createInvestigationHarness, writeDraft, baselineWorld, sampleCheckpoint, SESSION_ID } from '../investigation/investigationTestFixtures';
import { resolveInvestigationTaskBinding } from '../investigation/investigationTaskBinding';
import { enforceMissionTurnCompletion } from '../investigation/missionCompletionContract';
import type { HandoffContract } from '@shared/types/handoffContract';
import type { AgentRole } from '@shared/types/agent';
import type { TaskCompletionBinding } from '../agent-runtime/agent/TurnCompletionValidator';

vi.mock('../hooks/runtimeHookDispatch', () => ({ dispatchRuntimeHooks: async () => true }));
vi.mock('electron', () => ({ app: { getPath: () => process.env.TEMP, getAppPath: () => process.cwd() }, safeStorage: { isEncryptionAvailable: () => false } }));
const TEST_MODEL: Model = {
  id: 'test-model',
  name: 'Test model',
  provider: 'test-provider',
  api: 'test-api',
  contextWindow: 128_000,
  maxTokens: 4_096,
  reasoning: false,
  vision: false,
};

const TEST_REQUEST_PLAN = createTestRequestPlan({
  providerId: TEST_MODEL.provider,
  adapterId: 'openai-compatible',
  catalogRevision: 'test-catalog',
  routeRevision: 'test-route',
  selectedModelId: TEST_MODEL.id,
  effectiveModelId: TEST_MODEL.id,
  appliedBindingIds: [],
  route: {
    protocol: 'OpenAICompatibleChatCompletions',
    baseUrl: 'https://example.test',
    source: 'catalog',
  },
  headers: {},
  bodyPatch: {},
  contextBudgetTokens: TEST_MODEL.contextWindow,
  contextMode: 'normal',
  contextWindowTokens: TEST_MODEL.contextWindow,
  activeTierId: 'default',
  fastMode: false,
  reasoningWire: {
    selection: 'off',
    control: {
      kind: 'none',
      supportsOff: true,
      levels: [],
      defaultSelection: 'off',
      wireProfile: { kind: 'none' },
    },
  },
});


const roots: string[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

describe('deterministic provider with production loop, tools, artifacts and durable handoffs (no network)', () => {
  it.each(['debugger', 'analyzer', 'optimizer'] as const)('executes two planning/execution/evaluation cycles for %s', { timeout: 30000 }, async mission => {
    const harness = createInvestigationHarness('rdc-provider-fixture-', { now: () => new Date() }); roots.push(harness.sessionPath);
    const { service, resolver } = harness;
    const store = new HandoffStateStore({ io: new StorageIo(), sessions: { findSessionLocation: () => ({ sessionPath: harness.sessionPath }) } } as never);
    for (const method of ['computeNextChain', 'getActive', 'createPreparedDraft', 'abandonDraft', 'prepare', 'cancel', 'readDocument'] as const) {
      vi.spyOn(storageAdapter.handoffs, method).mockImplementation(store[method].bind(store) as never);
    }
    vi.spyOn(sessionArtifactResolver, 'read').mockImplementation(resolver.read.bind(resolver));
    vi.spyOn(sessionArtifactResolver, 'write').mockImplementation(resolver.write.bind(resolver));
    vi.spyOn(investigationArtifactService, 'list').mockImplementation(service.list.bind(service));
    vi.spyOn(investigationArtifactService, 'readRecord').mockImplementation(service.readRecord.bind(service));
    const assembly = new RuntimeToolAssembly({ mcp: { getConnectedTools: () => [], getAgentTools: () => [] }, getActiveTurn: () => null,
      getMemoryStore: () => ({}), createSubagentTools: () => [], getMcpServerStatusSummary: () => [] } as never);
    const route = mission !== 'debugger'; // direct Mission and initial General routing are both exercised
    let turn = 'user-turn'; let binding: TaskCompletionBinding | null = null;
    async function run(profile: AgentRole, call: { name: string; args: Record<string, unknown> }) {
      const handle = new TurnHandle({ sessionKey: SESSION_ID, turnId: turn, runId: 'fixture-run', generation: 1 });
      handle.eventSink = { sessionId: SESSION_ID, requestId: 'request-' + turn } as never;
      handle.runtimePlan = { projectRootPath: null, taskBinding: binding,
        profileHandoffs: ['general', mission].filter(id => id !== profile).map(agent => ({ agent, label: '交接', prompt: 'unused default' })),
        enabledProfileIds: ['general', mission] } as never;
      const tool = call.name === 'plan_artifact' ? assembly.createPlanArtifactTool(SESSION_ID) : assembly.createAgentHandoffTool(profile, SESSION_ID, handle);
      let response: ToolResultMessage | undefined; let requests = 0;
      const provider: ProviderStrategy = { api: TEST_MODEL.api, stream: () => {
        const first = requests++ === 0;
        const message: AssistantMessage = { role: 'assistant', content: first ? [{ type: 'toolCall', id: 'fixture-call', name: call.name, arguments: call.args }] : [{ type: 'text', text: '本步骤已记录。' }],
          model: TEST_MODEL.id, provider: TEST_MODEL.provider, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, stopReason: first ? 'toolUse' : 'stop', timestamp: Date.now() };
        const stream = new EventStream<AssistantMessageEvent, AssistantMessage>();
        queueMicrotask(() => { stream.push({ type: 'start', partial: { ...message, content: [] } }); stream.push({ type: 'done', reason: message.stopReason as 'stop' | 'toolUse', message }); stream.complete(message); });
        return stream;
      } };
      const { stream } = agentLoop([], { messages: [], runtime: { current: { revision: 1, activeTools: [tool], activatedDeferredTools: new Set() } } },
        { model: TEST_MODEL, convertToLlm: messages => messages as Message[], maxTurns: 3, streamOptions: { requestPlan: TEST_REQUEST_PLAN } }, provider,
        { execute: async tc => {
          const result = await tool.execute(tc.id, tc.arguments as never);
          response = { role: 'toolResult', toolCallId: tc.id, toolName: tc.name, ...result, isError: result.isError === true, timestamp: Date.now() };
          return response!;
        } });
      for await (const _event of stream) { /* drain real loop */ }
      expect(requests).toBe(2);
      return response!;
    }
    async function transfer(profile: AgentRole, target: string, contract: HandoffContract) {
      const result = await run(profile, { name: 'agent_handoff', args: { agent: target, prompt: '中文摘要：依据当前证据继续，保留未知边界。', contract } });
      expect(result.isError, JSON.stringify(result)).not.toBe(true);
      const pending = store.commit(SESSION_ID, turn)!;
      if (profile === 'general' && binding) enforceMissionTurnCompletion({ profileId: profile, sessionId: SESSION_ID, turnId: turn, taskBinding: binding, pendingHandoff: true, pendingHandoffTarget: target, finalAnswerText: '回交', service });
      binding = resolveInvestigationTaskBinding(SESSION_ID, target);
      turn = 'continued-' + pending.handoffId;
      store.consume(SESSION_ID, pending.handoffId, turn);
      expect(() => store.consume(SESSION_ID, pending.handoffId, turn)).toThrow(/STATE_CONFLICT/);
      return pending;
    }
    if (route) await transfer('general', mission, { intent: 'route' });
    writeDraft(service, 'world_state', baselineWorld('ws-baseline'), { mission });
    let checkpoint: ReturnType<typeof writeDraft> | undefined;
    let contract: HandoffContract;
    for (let cycle = 0; cycle < 2; cycle++) {
      const domainPlan = { debugger: '预期与实际、复现条件；First Bad Event 候选与竞争假设，因果介入后回滚。', analyzer: '解释范围与覆盖；Observed / Reconstructed / Authoring 分层，保留 Unknown Frontier。', optimizer: '质量与成本约束；合格 baseline 和噪声，区分 Cost / Limiter / Mechanism；A-B-A 恢复和视觉回归。' }[mission];
      const plan = await run(mission, { name: 'plan_artifact', args: { content: '## 目标与边界\n定位偏差。\n## 输入与参考依据\nKnowledge 仅候选，反例未排除。\n## 候选方向与选择依据\n最小区分检查。\n## 执行策略与依赖\n先检查再介入，允许局部补证。\n## 决策与循环\n预算停止。\n## 交付与回评估\n回交证据。' + domainPlan + (checkpoint ? '\n上一 Checkpoint: ' + checkpoint.contentUri : '') } });
      const ref = plan.details as { uri: string; hash: string };
      contract = { intent: 'execute', plan: { uri: ref.uri, hash: ref.hash }, requiredSkillIds: ['renderdoc-execution'], returnTo: mission, deliveryRequirements: '更新 Checkpoint 并列出缺口' };
      const execution = await transfer(mission, 'general', contract);
      const before = store.readDocument(SESSION_ID)!.history!.length;
      if (cycle === 0) {
        const wrongReturn = await run('general', { name: 'agent_handoff', args: { agent: mission, prompt: '伪造回交绑定', contract: { intent: 'return', executionHandoffId: 'wrong-binding', artifacts: [ref] } } });
        expect(wrongReturn.isError).toBe(true);
        expect(store.getActive(SESSION_ID)).toBeNull();
      }
      // A Small Loop updates evidence twice in the same bound execution, without another dispatch.
      for (let small = 0; small < 2; small++) checkpoint = writeDraft(service, 'checkpoint', { ...sampleCheckpoint({ currentWorldStateId: 'ws-baseline', checkpointId: 'cp-' + cycle + '-' + small }), unresolvedFrontier: '仍需真实设备验证。' }, { mission });
      expect(store.readDocument(SESSION_ID)!.history).toHaveLength(before);
      await transfer('general', mission, { intent: 'return', executionHandoffId: execution.handoffId, artifacts: [{ uri: checkpoint!.contentUri, hash: checkpoint!.contentHash }] });
    }
    const rejected = await run(mission, { name: 'agent_handoff', args: { agent: 'general', prompt: '第三轮', contract: contract! } });
    expect(rejected.isError).toBe(true); expect(JSON.stringify(rejected)).toMatch(/CYCLE_LIMIT|CHAIN_LIMIT/);
    expect(store.getActive(SESSION_ID)).toBeNull();
    expect(() => enforceMissionTurnCompletion({ profileId: mission, sessionId: SESSION_ID, turnId: turn, finalAnswerText: '仍需真实设备验证。等待新指令。', disposition: 'budget_paused', evidenceRefs: [{ uri: checkpoint!.contentUri, hash: checkpoint!.contentHash }], service })).not.toThrow();
    expect(() => enforceMissionTurnCompletion({ profileId: mission, sessionId: SESSION_ID, turnId: turn, finalAnswerText: '调查已完成', service })).toThrow();
    expect(() => enforceMissionTurnCompletion({ profileId: mission, sessionId: SESSION_ID, turnId: 'forged-new-turn', finalAnswerText: '仍需真实设备验证。', disposition: 'budget_paused', evidenceRefs: [{ uri: checkpoint!.contentUri, hash: checkpoint!.contentHash }], service })).toThrow();
    expect(store.readDocument(SESSION_ID)!.history!.filter(item => item.contract.intent === 'return')).toHaveLength(2);
    turn = 'new-user-cancel';
    expect((await run(mission, { name: 'agent_handoff', args: { agent: 'general', prompt: '新的用户指令派发', contract: contract! } })).isError).not.toBe(true);
    store.cancel(SESSION_ID, 'user_stop');
    expect(store.getActive(SESSION_ID)).toBeNull();
    turn = 'new-user-restart';
    expect((await run(mission, { name: 'agent_handoff', args: { agent: 'general', prompt: '重启前的交接', contract: contract! } })).isError).not.toBe(true);
    store.commit(SESSION_ID, turn);
    store.forgetLiveHandoffs();
    expect(store.hydrate(SESSION_ID)?.cancelReason).toBe('restart_degrade');
    expect(store.getActive(SESSION_ID)).toBeNull();
  });
});
