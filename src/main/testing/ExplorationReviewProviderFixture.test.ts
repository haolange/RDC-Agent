import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import YAML from 'yaml';
import { expect, it, vi } from 'vitest';
import { EventStream } from '../agent-runtime/core/EventStream';
import type { ProviderStrategy } from '../agent-runtime/core/ProviderRegistry';
import type { AssistantMessage, AssistantMessageEvent, Message, Model, Context } from '../agent-runtime/core/types';
import type { AgentTool } from '../agent-runtime/agent/AgentTool';
import type { AgentManifestDefinition } from '@shared/types/agentManifest';
import type { DelegationCapsule } from '@shared/types/delegationCapsule';
import { agentLoop } from '../agent-runtime/agent/AgentLoop';
import { createTestRequestPlan } from './createTestRequestPlan';
import { PromptPlanBuilder } from '../agent-runtime/prompt/PromptPlanBuilder';
import { RuntimeToolAssembly } from '../workflow/debugger/RuntimeToolAssembly';
import { SubagentRunner } from '../workflow/debugger/SubagentRunner';
import { TurnHandle } from '../workflow/debugger/TurnCoordinator';
import { settingsService } from '../settings/SettingsService';
import { agentManifestService } from '../settings/AgentManifestService';
import { sessionArtifactResolver } from '../sessions/SessionArtifactResolver';
import { artifactizeToolResult } from '../agent-runtime/tools/ToolResultArtifactizer';
import { artifactReadTool } from '../agent-runtime/tools/primitives/ArtifactReadTool';
import { createInvestigationTools } from '../investigation/InvestigationTools';
import { createInvestigationHarness, writeDraft, baselineWorld, hypothesisClaim, sampleChallenge, sampleCheckpoint, SESSION_ID } from '../investigation/investigationTestFixtures';

vi.mock('electron', () => ({ app: { getPath: () => process.env.TEMP, getAppPath: () => process.cwd() }, safeStorage: { isEncryptionAvailable: () => false } }));
vi.mock('../hooks/runtimeHookDispatch', () => ({ dispatchRuntimeHooks: async () => true }));
vi.mock('../runtime/resolveConfiguredShell', () => ({ resolveConfiguredShell: () => { throw new Error('No shell in provider fixture'); } }));
const TEST_MODEL: Model = {
  id: 'test-model',
  name: 'Test model',
  provider: 'test-provider',
  api: 'test-api',
  contextWindow: 128_000,
  maxTokens: 4_096,
  reasoning: false,
  vision: true,
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



it('isolates Scout and Skeptic provider inputs, preserves evidence, and lets Mission evaluate after the user returns', { timeout: 30000 }, async () => {
  const harness = createInvestigationHarness('rdc-exploration-provider-');
  const { resolver, service } = harness;
  const profiles = ['general', 'debugger'].map((id) => ({ id, enabled: true, instructions: `Identity ${id}`, skills: [], tools: [], agents: ['general'], handoffs: [], metadata: {}, models: [], mcpServers: [], filePath: `fixture/${id}.agent.md`, name: id, description: id } as unknown as AgentManifestDefinition));
  vi.spyOn(settingsService, 'getAll').mockReturnValue({ paths: { userRdxRoot: harness.sessionPath }, llm: { providers: [], agentRoutes: [] } } as never);
  vi.spyOn(agentManifestService, 'getEffectiveProfiles').mockReturnValue(profiles as never);
  vi.spyOn(sessionArtifactResolver, 'read').mockImplementation(resolver.read.bind(resolver));
  vi.spyOn(sessionArtifactResolver, 'write').mockImplementation(resolver.write.bind(resolver));
  const assembly = new RuntimeToolAssembly({ mcp: { getConnectedTools: () => [], getAgentTools: () => [] }, getActiveTurn: () => null, getMemoryStore: () => ({}), createSubagentTools: () => [], getMcpServerStatusSummary: () => [] } as never);
  const rawText = Array.from({ length: 200 }, (_, i) => `Source ${i}: hypothesis only, capture A, fixed camera; negative path valid only for driver X.
`).join('');
  const raw = resolver.write(SESSION_ID, 'session://tool-outputs/scout-source.txt', Buffer.from(rawText), { mimeType: 'text/plain' });
  writeDraft(service, 'world_state', baselineWorld());
  const claim = writeDraft(service, 'claim', hypothesisClaim('ws-baseline'));
  const image = resolver.write(SESSION_ID, 'session://tool-outputs/before.png', Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j0ioAAAAASUVORK5CYII=', 'base64'), { mimeType: 'image/png' });
  const refs = [{ uri: image.uri, hash: image.hash }, { uri: raw.uri, hash: raw.hash }, { uri: claim.contentUri, hash: claim.contentHash }];
  const requests = new Map<string, Context[]>();
  const toolResults = new Map<string, unknown[]>();
  type Step = () => { name: string; args: Record<string, unknown> };
  async function runLoop(label: string, tools: AgentTool[], steps: Step[], messages: Message[], systemPrompt = '') {
    let count = 0;
    const provider: ProviderStrategy = { api: TEST_MODEL.api, stream: (_model, context) => {
      requests.set(label, [...(requests.get(label) ?? []), JSON.parse(JSON.stringify(context))]);
      const call = steps[count++]?.();
      const message: AssistantMessage = { role: 'assistant', content: call ? [{ type: 'toolCall', id: `${label}-${count}`, name: call.name, arguments: call.args }] : [{ type: 'text', text: `${label} finished` }], model: TEST_MODEL.id, provider: TEST_MODEL.provider, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, stopReason: call ? 'toolUse' : 'stop', timestamp: Date.now() };
      const stream = new EventStream<AssistantMessageEvent, AssistantMessage>();
      queueMicrotask(() => { stream.push({ type: 'done', reason: call ? 'toolUse' : 'stop', message }); stream.complete(message); }); return stream;
    } };
    const { stream } = agentLoop([], { messages, systemPrompt, runtime: { current: { revision: 1, activeTools: tools, activatedDeferredTools: new Set() } } }, { model: TEST_MODEL, maxTurns: 12, convertToLlm: (items) => items as Message[], streamOptions: { requestPlan: TEST_REQUEST_PLAN } }, provider, { execute: async (call) => {
      const tool = tools.find((item) => item.name === call.name)!;
      const executed = await tool.execute(call.id, call.arguments, undefined, undefined, { sessionId: label.startsWith('child:') ? label.slice(6) : SESSION_ID, workspaceRoot: harness.sessionPath, projectRootPath: null, projectId: null, visionInputMode: 'native' });
      const result = artifactizeToolResult({ sessionId: label.startsWith('child:') ? label.slice(6) : SESSION_ID, toolCallId: call.id, toolName: call.name, result: executed, resolver });
      expect(result.isError, JSON.stringify(result)).not.toBe(true);
      toolResults.set(label, [...(toolResults.get(label) ?? []), result]);
      return { role: 'toolResult', toolCallId: call.id, toolName: call.name, ...result, isError: false, timestamp: Date.now() };
    } });
    for await (const event of stream) { if (event.type === 'error') throw new Error(JSON.stringify(event)); }
    return `${label} finished`;
  }
  const scope = 'Capture A only; inferred hypothesis, not verified; driver X negative path must be rechecked on driver change.';
  const makeCapsule = (skill: string): DelegationCapsule => ({ goal: skill === 'knowledge-scout' ? 'Synthesize source conditions' : 'Independently challenge the claim', task: skill, scope, acceptedFacts: [{ statement: 'Claim is only inferred', qualification: 'hypothesis, reconstructed', sourceRefs: [claim.contentUri] }], hypotheses: ['shader', 'state'], challengeRefs: [], negativePaths: [{ path: 'driver X', reason: 'prior negative test', applicableWhen: 'same driver/camera', recheckWhen: 'driver or camera changes' }], inputArtifactRefs: refs.map((ref) => ref.uri), requiredSkillIds: [skill], budget: { maxToolCalls: 5, maxWallTimeMs: 20000 }, stopConditions: ['Return after bounded synthesis'], outputRequirements: 'Return structured evidence, counterevidence and limits', profile: 'general' });
  const childSessions: string[] = [];
  const runner = new SubagentRunner({ getActiveTurn: () => null, systemPromptForAgent: () => 'General', sendProfileMessage: async (_profile, text, options) => {
    const sessionId = options!.sessionId!; childSessions.push(sessionId);
    const skillId = options!.preloadSkillIds![0]!;
    const sourcePath = path.join(process.cwd(), 'resources/agent-runtime/skills', skillId, 'SKILL.md');
    const source = fs.readFileSync(sourcePath, 'utf8');
    const split = /^---\r?\n([\s\S]*?)\r?\n---([\s\S]*)$/u.exec(source)!;
    const meta = YAML.parse(split[1]!);
    const handle = new TurnHandle({ sessionKey: sessionId, turnId: sessionId, generation: 1, policyBudget: options!.policyBudget });
    const tools = [artifactReadTool as unknown as AgentTool, assembly.createTurnCompletionTool(handle), ...createInvestigationTools(sessionId, { service })].filter((tool) => meta['allowed-tools'].includes(tool.name));
    const plan = new PromptPlanBuilder().build({ profile: profiles[0]!, scopedInstructions: { sources: [], diagnostics: [], totalBytes: 0 }, preloadedSkills: [{ id: skillId, name: skillId, description: meta.description, allowedTools: meta['allowed-tools'], scope: 'builtin', sourcePath, sourceHash: createHash('sha256').update(source).digest('hex'), effectiveStatus: 'effective', instructions: split[2]! }], skillCatalog: [], tools: tools.map((tool) => tool.name), workDir: harness.sessionPath, routeCapability: { visionInputMode: 'native' } as never, permissionSettings: { mode: 'default', readableRoots: [], writableRoots: [], allowedCommandPrefixes: [], deniedCommandPrefixes: [] }, currentDate: '2026-09-10', timeZone: 'Asia/Shanghai', extraSegments: [...(options!.extraPromptSegments ?? [])] });
    const steps: Step[] = [() => ({ name: 'artifact_read', args: { uri: raw.uri, expectedHash: raw.hash } }), () => ({ name: 'artifact_read', args: { uri: image.uri, expectedHash: image.hash } })];
    if (skillId === 'skeptic-review') steps.push(() => ({ name: 'investigation_write', args: { kind: 'challenge', mission: 'debugger', title: 'Independent challenge', summary: 'Driver condition is unresolved', record: sampleChallenge({ targetId: 'claim-hyp', requiredFollowUp: 'Check driver Y with fixed camera' }) } }));
    steps.push(() => ({ name: 'turn_complete', args: { disposition: 'partial', evidenceRefs: refs, result: { summary: skillId === 'knowledge-scout' ? 'Source synthesis: conditional hypothesis only.' : 'Independent challenge requires driver Y follow-up.', outputs: { finding: 'Conditional hypothesis' }, counterevidence: ['Driver Y was not tested'], unresolved: ['Driver Y'], scope, sideEffects: [], recoveryState: ['No live mutation'] } } }));
    try {
      const output = await runLoop(`child:${sessionId}`, tools, steps, [{ role: 'user', content: text, timestamp: Date.now() }], plan.systemPrompt);
      options!.onTerminalContext?.({ messages: [], status: 'complete', executionIdentity: TEST_REQUEST_PLAN.executionIdentity, completionDeclaration: handle.completionDeclaration } as never);
      return output;
    } finally { handle.close(); }
  } });
  try {
    const parentHandle = new TurnHandle({ sessionKey: SESSION_ID, turnId: 'general-execution', generation: 1 });
    parentHandle.eventSink = { sessionId: SESSION_ID, requestId: 'general-request' } as never;
    parentHandle.runtimePlan = { profileDelegates: ['general'], profileHandoffs: [], enabledProfileIds: ['general', 'debugger'] } as never;
    const tools = [artifactReadTool as unknown as AgentTool, ...runner.createSubagentTools('general', SESSION_ID, parentHandle), ...createInvestigationTools(SESSION_ID, { service })];
    const privateNarrative = 'General private exploration history: '.repeat(80);
    await runLoop('general', tools, [() => ({ name: 'subagent', args: { ...makeCapsule('knowledge-scout') } }), () => ({ name: 'subagent', args: { ...makeCapsule('skeptic-review') } }), () => ({ name: 'artifact_read', args: { uri: raw.uri, expectedHash: raw.hash } }), () => ({ name: 'investigation_write', args: { kind: 'checkpoint', mission: 'debugger', title: 'Follow-up conditions', summary: 'Driver Y follow-up remains unverified', record: { ...sampleCheckpoint({ currentWorldStateId: 'ws-baseline' }), unresolvedFrontier: 'Driver Y requires device; same camera condition retained.' } } })], [{ role: 'user', content: privateNarrative, timestamp: Date.now() }]);
    await runLoop('mission-evaluation', [artifactReadTool as unknown as AgentTool], [() => ({ name: 'artifact_read', args: { uri: service.list(SESSION_ID).find((item) => item.kind === 'checkpoint')!.contentUri } })], [{ role: 'user', content: 'Evaluate the explicit returned evidence and unresolved scope.', timestamp: Date.now() }]);
    expect(childSessions).toHaveLength(2); expect(new Set(childSessions).size).toBe(2);
    for (const session of childSessions) {
      const first = requests.get(`child:${session}`)![0]!;
      expect(first.messages).toHaveLength(1);
      const childFinal = requests.get(`child:${session}`)!.at(-1)!;
      expect(childFinal.messages.some((message) => message.role === 'toolResult' && message.content.some((part) => part.type === 'image' && part.data.length > 0))).toBe(true);
      expect(JSON.stringify(first.messages)).not.toContain(privateNarrative);
      expect(first.messages[0]!.role).toBe('user');
      const serialized = String((first.messages[0] as { content: unknown }).content);
      const capsule = JSON.parse(serialized.slice(serialized.indexOf('{'))) as DelegationCapsule;
      expect(capsule.negativePaths[0]).toMatchObject({ applicableWhen: 'same driver/camera', recheckWhen: 'driver or camera changes' });
      expect(capsule.acceptedFacts[0]!.qualification).toBe('hypothesis, reconstructed');
      expect(capsule.inputArtifactRefs).toEqual(refs.map((ref) => ref.uri));
      expect(requests.get(`child:${session}`)!.at(-1)!.messages.some((message) => message.role === 'toolResult')).toBe(true);
    }
    const parentFinal = requests.get('general')!.at(-1)!;
    const returnedChildren = parentFinal.messages.filter((message) => message.role === 'toolResult' && message.toolName === 'subagent');
    expect(returnedChildren).toHaveLength(2);
    for (const message of returnedChildren) {
      if (message.role !== 'toolResult') throw new Error('Expected child tool result');
      const text = JSON.stringify(message.content);
      expect(text.length).toBeLessThan(rawText.length / 2);
      expect(text).not.toContain(rawText);
      expect(text).toContain('Driver Y'); expect(text).toContain(raw.hash);
      const block = message.content.find((part) => part.type === 'text');
      if (!block || block.type !== 'text') throw new Error('Missing structured child result');
      const projection = JSON.parse(block.text) as { resultRef: string; resultHash: string };
      expect(projection.resultRef).toMatch(/^session:\/\//);
      expect(projection.resultHash).toMatch(/^[a-f0-9]{64}$/);
      const restored = resolver.read(SESSION_ID, projection.resultRef, { expectedHash: projection.resultHash });
      expect(restored.hash).toBe(projection.resultHash);
      expect(restored.text).toContain('Driver Y');
    }
    expect(service.list(SESSION_ID).some((item) => item.kind === 'challenge')).toBe(true);
    expect(resolver.read(SESSION_ID, raw.uri, { expectedHash: raw.hash }).text).toBe(rawText);
    parentHandle.close();
  } finally { vi.restoreAllMocks(); fs.rmSync(harness.sessionPath, { recursive: true, force: true }); }
});
