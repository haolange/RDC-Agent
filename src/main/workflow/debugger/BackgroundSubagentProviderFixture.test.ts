import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { getPath: () => process.cwd(), getAppPath: () => process.cwd() } }));
vi.mock('../../settings/SettingsService', () => ({ settingsService: { getAll: () => ({ paths: {}, llm: { providers: [], agentRoutes: [] } }) } }));
vi.mock('../../settings/AgentManifestService', () => ({ agentManifestService: { getEffectiveProfiles: () => [{ id: 'general', enabled: true, instructions: 'General', tools: [], skills: [], mcpServers: [], handoffs: [], agents: ['general'] }] } }));

import type { DelegationCapsule } from '@shared/types/delegationCapsule';
import { TaskRegistry } from '../../agent-runtime/tasks';
import { SubagentRunner } from './SubagentRunner';
import { createBackgroundSubagentService } from './BackgroundSubagentService';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

describe('background SubagentRunner provider fixture', () => {
  it('forwards only the Capsule explicit model through the detached runner adapter', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'background-model-')); roots.push(root);
    let receivedModel: string | undefined;
    const parentEvents: string[] = [];
    const fakeRunner = { runSubagent: vi.fn(async (input: Parameters<SubagentRunner['runSubagent']>[0]) => {
      receivedModel = input.model;
      for (const type of ['approval.requested', 'approval.answered'] as const) {
        input.parentOnEvent?.({ id: type, type, timestamp: Date.now(), sessionId: 'parent', agentId: 'general', payload: { approvalId: 'approval', title: 'Approve', status: 'approved' } });
      }
      return { text: 'done', status: 'completed', subagentId: 'child', completionDeclaration: { disposition: 'completed', evidenceRefs: [], result: { summary: 'done', outputs: {}, counterevidence: [], unresolved: [], scope: 'fixture', sideEffects: [], recoveryState: [] } } };
    }) } as unknown as SubagentRunner;
    let registry!: TaskRegistry;
    const service = createBackgroundSubagentService(fakeRunner, {
      createRegistry: (_sessionId, onCancel) => { registry = new TaskRegistry(root, { onCancelExecution: onCancel }); return registry; },
      persistResult: (_sessionId, executionId) => ({ uri: `session://tool-outputs/background-${executionId}.json`, hash: 'fixture-hash' }),
    });
    await service.query('parent', 'missing');
    const task = await registry.createTask('model fixture');
    const capsule = { goal: 'inspect', task: 'inspect', scope: 'fixture', acceptedFacts: [], hypotheses: [], challengeRefs: [], negativePaths: [], inputArtifactRefs: [], outputRequirements: 'typed result', stopConditions: [], requiredSkillIds: [], budget: { maxToolCalls: 2, maxWallTimeMs: 10_000 }, model: 'openai:gpt-5.6-luna' } satisfies DelegationCapsule;
    const execution = await service.start({ parentToolCallId: 'test-tool', sessionId: 'parent', taskId: task.id, parentAgentId: 'general', targetProfile: 'general', capsule, parentOnEvent: (event) => { parentEvents.push(event.type); } });
    await service.join(execution.id);
    expect(receivedModel).toBe('openai:gpt-5.6-luna');
    expect(parentEvents).toEqual(['approval.requested', 'approval.answered']);
  });

  it('keeps parent and child requests isolated, delivers a safe-boundary message, and binds only the first request snapshot', async () => {
    let continueChild!: () => void;
    const gate = new Promise<void>((resolve) => { continueChild = resolve; });
    const childRequests: string[] = [];
    const runner = new SubagentRunner({
      systemPromptForAgent: () => 'General', getActiveTurn: () => null,
      sendProfileMessage: async (_agent, content, options) => {
        childRequests.push(content);
        await options?.onProviderRequestCommitted?.('child-request-1');
        await gate;
        const pending = await options?.beforeProviderRequestMessages?.();
        childRequests.push(JSON.stringify(pending?.messages ?? []));
        await pending?.commit?.();
        await options?.onProviderRequestCommitted?.('child-request-2');
        options?.onTerminalContext?.({ messages: [], executionIdentity: { fingerprint: 'fixture' } as never, status: 'complete', selectedTurnCount: 0, filteredArtifactCount: 0, completionDeclaration: { disposition: 'completed', evidenceRefs: [], result: { summary: 'fixture done', outputs: {}, counterevidence: [], unresolved: [], scope: 'fixture', sideEffects: [], recoveryState: [] } } });
        return 'fixture done';
      },
    });
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'background-provider-')); roots.push(root);
    const registries = new Map<string, TaskRegistry>();
    const service = createBackgroundSubagentService(runner, {
      createRegistry: (sessionId, onCancel) => { const registry = new TaskRegistry(path.join(root, sessionId), { onCancelExecution: onCancel }); registries.set(sessionId, registry); return registry; },
      persistResult: (_sessionId, executionId) => ({ uri: `session://tool-outputs/background-${executionId}.json`, hash: 'fixture-hash' }),
    });
    await service.query('parent', 'missing');
    const registry = registries.get('parent')!;
    const task = await registry.createTask('provider fixture');
    const capsule: DelegationCapsule = { goal: 'inspect', task: 'inspect', scope: 'fixture', acceptedFacts: [], hypotheses: [], challengeRefs: [], negativePaths: [], inputArtifactRefs: [], outputRequirements: 'typed result', stopConditions: [], requiredSkillIds: [], budget: { maxToolCalls: 2, maxWallTimeMs: 10_000 } };
    const execution = await service.start({ parentToolCallId: 'test-tool', sessionId: 'parent', taskId: task.id, parentAgentId: 'general', targetProfile: 'general', capsule });
    await service.postMessage('parent', execution.id, execution.generation, 'new owner observation');
    continueChild();
    await service.join(execution.id);
    expect(childRequests[0]).not.toContain('new owner observation');
    expect(childRequests[1]).toContain('new owner observation');
    expect((await registry.getExecution(execution.id))?.frozenPlanRef).toBe('child-request-1');
  });
});
