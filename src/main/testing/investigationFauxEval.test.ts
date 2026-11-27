import fs from 'node:fs';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { EventStream } from '../agent-runtime/core/EventStream';
import { agentLoop } from '../agent-runtime/agent/AgentLoop';
import { createRdcProbeTool } from '../agent-runtime/orchestration/RdcProbeTool';
import { artifactizeToolResult } from '../agent-runtime/tools/ToolResultArtifactizer';
import { createInvestigationTools } from '../investigation/InvestigationTools';
import { clearRdcContextLeases, setRdcRuntimeContextForSession } from '../rdc/RdcRuntimeContextRegistry';
import { freezeRdcTurnBinding } from '../rdc/RdcTurnBindings';
import { applyTerminalAppend, prepareTerminalAppend } from '../sessions/store/ConversationTerminalAppend';
import { createInvestigationHarness, projectClaim, sampleReportContract } from './investigationTestFixtures';
import { createTestRequestPlan } from './createTestRequestPlan';
import type { AgentTool } from '../agent-runtime/agent/AgentTool';
import type { ProviderStrategy } from '../agent-runtime/core/ProviderRegistry';
import type {
  AssistantMessage,
  AssistantMessageEvent,
  Context,
  Message,
  Model,
  ToolCallContent,
  ToolResultMessage,
} from '../agent-runtime/core/types';
import type { SessionContextTurnEntry } from '../agent-runtime/context/SessionContextJournal';
import type { ClaimRecord } from '@shared/types/renderdocInvestigation';
import type { ConversationMessage } from '@shared/types/conversation';

vi.mock('electron', () => ({
  app: { getPath: () => process.env.TEMP ?? process.cwd(), getAppPath: () => process.cwd() },
  safeStorage: { isEncryptionAvailable: () => false },
}));

/**
 * Faux-provider investigation eval (`node scripts/eval-investigation.mjs --faux`). One investigation turn runs through
 * the agent loop with a scripted provider: the product's `rdc_probe` tool queries a recorded native replay (the
 * suite's `faux.replay`, served where the RDC-Tool CLI would answer), tool results are artifactized and pinned as
 * session evidence, the investigation tools record Evidence, observed Claims and a Report, and the turn commits
 * through the terminal append that writes conversation.jsonl and session-context.jsonl. The scripted model derives
 * its answers only from the tool results it receives. With RDC_EVAL_FAUX_OUT set, the session directory is copied
 * there for the eval script to grade (answers, required tool calls, evidence citations); a real-model session is
 * graded by the same script.
 */

const SUITE_PATH = process.env.RDC_EVAL_TASKS ?? path.join(process.cwd(), 'scripts/evals/vkcube-lavapipe.json');
const suite = JSON.parse(fs.readFileSync(SUITE_PATH, 'utf8')) as {
  prompt: Record<string, string>;
  faux: { replay: Record<string, Record<string, unknown>> };
};

const SESSION_ID = 'eval-faux-session';
const PROJECT_ID = 'eval-faux-project';
const MODEL: Model = {
  id: 'faux-model',
  name: 'Faux model',
  provider: 'faux',
  api: 'faux',
  contextWindow: 128_000,
  maxTokens: 4_096,
  reasoning: false,
  vision: false,
};
const REQUEST_PLAN = createTestRequestPlan({
  providerId: MODEL.provider,
  adapterId: 'openai-compatible',
  catalogRevision: 'eval-faux',
  routeRevision: 'eval-faux',
  selectedModelId: MODEL.id,
  effectiveModelId: MODEL.id,
  appliedBindingIds: [],
  route: { protocol: 'OpenAICompatibleChatCompletions', baseUrl: 'https://faux.invalid', source: 'catalog' },
  headers: {},
  bodyPatch: {},
  contextBudgetTokens: MODEL.contextWindow,
  contextMode: 'normal',
  contextWindowTokens: MODEL.contextWindow,
  activeTierId: 'default',
  fastMode: false,
  reasoningWire: {
    selection: 'off',
    control: { kind: 'none', supportsOff: true, levels: [], defaultSelection: 'off', wireProfile: { kind: 'none' } },
  },
});
const CLI_SETTINGS = {
  enabled: true,
  command: 'faux-rdc-tool',
  argsPrefix: [],
  workingDirectory: '',
  env: {},
  noProgressTimeoutMs: 300_000,
};

afterEach(clearRdcContextLeases);

/** The recorded native replay answers each operation; every answer carries the replay's process identity. */
function replayCli(replay: Record<string, Record<string, unknown>>) {
  const answer = (operation: string) => {
    const body = replay[operation];
    if (!body) throw new Error(`faux replay has no answer for ${operation}`);
    return { exitCode: 0, stdout: JSON.stringify(body), stderr: '', duration_ms: 1 };
  };
  return async (command: string, args: string[] = []) =>
    answer(command === 'call' ? args[0]! : command === 'pipeline' ? 'rd.pipeline.get_state' : command);
}

interface ActionNode {
  event_id: number;
  name: string;
  flags: string[];
  num_indices?: number;
  children?: ActionNode[];
}

const flatten = (nodes: ActionNode[]): ActionNode[] => nodes.flatMap((node) => [node, ...flatten(node.children ?? [])]);

/** The evidence URI and hash the artifactizer appends to a pinned tool result. */
function evidenceRef(result: ToolResultMessage): { uri: string; hash: string } {
  const text = result.content.map((block) => (block.type === 'text' ? block.text : '')).join('\n');
  const match = /Evidence ref: (\S+)\nhash: (\S+)/.exec(text);
  if (!match) throw new Error(`tool result carries no evidence ref: ${text.slice(0, 200)}`);
  return { uri: match[1]!, hash: match[2]! };
}

const nativeData = (result: ToolResultMessage) =>
  (JSON.parse((result.content[0] as { text: string }).text) as { data: Record<string, unknown> }).data;

/**
 * The scripted model: list the action tree, read the pipeline at the draw it found, record what it observed, and
 * answer from those two results. Each step reads the tool results already in its context.
 */
function scriptedModel(context: Context): ToolCallContent | string {
  const results = context.messages.filter((message): message is ToolResultMessage => message.role === 'toolResult');
  const [tree, pipeline] = results;
  const call = (name: string, args: Record<string, unknown>): ToolCallContent => ({
    type: 'toolCall',
    id: `call-${results.length + 1}`,
    name,
    arguments: args,
  });
  if (!tree) return call('rdc_probe', { action: 'probe', args: { action: 'event_list' } });
  const actions = flatten((nativeData(tree).actions ?? []) as ActionNode[]);
  const draw = actions.find((node) => node.flags.includes('Drawcall'))!;
  const present = actions.find((node) => node.flags.includes('Present'))!;
  if (!pipeline)
    return call('rdc_probe', { action: 'probe', args: { action: 'pipeline_show', eventId: String(draw.event_id) } });
  const state = nativeData(pipeline).pipeline_state as {
    output_targets: Array<{ format: string; width: number; height: number }>;
    shaders: Array<{ stage: string; bound: boolean }>;
  };
  const target = state.output_targets[0]!;
  const stages = state.shaders.filter((shader) => shader.bound).map((shader) => shader.stage);
  const worldStateId = 'ws-replay';
  const observed = (claimId: string, statement: string, evidenceId: string): ClaimRecord => ({
    claimId,
    claimKind: 'observed_fact',
    statement,
    epistemic: 'observed',
    confidence: 'exact',
    verification: 'observed',
    worldStateId,
    experimentId: null,
    declaresCounterfactual: false,
    scope: { capture: 'vkcube_lavapipe', eventId: String(draw.event_id) },
    projectionKind: null,
    compactProvenance: null,
    evidenceIds: [evidenceId],
  });
  const treeClaim = observed(
    'claim-tree',
    `Event ${draw.event_id} is the only draw (${draw.num_indices} vertices); event ${present.event_id} presents; ${actions.length} actions.`,
    'ev-tree',
  );
  const pipelineClaim = observed(
    'claim-pipeline',
    `The draw writes ${target.format} ${target.width}x${target.height} with ${stages.join(' and ')} bound.`,
    'ev-pipeline',
  );
  const evidence = (evidenceId: string, ref: { uri: string; hash: string }, summary: string) => ({
    evidenceId,
    mission: 'debugger',
    observationKind: 'other',
    summary,
    epistemicStatus: 'observed',
    worldStateId,
    source: { kind: 'tool', name: 'rdc_probe', parameterFingerprint: evidenceId },
    artifactRefs: [{ uri: ref.uri, expectedHash: ref.hash }],
    claimIds: [],
    strength: 'strong',
    stale: false,
  });
  const write = (kind: string, record: unknown) =>
    call('investigation_write', { kind, mission: 'debugger', title: kind, summary: kind, record, status: 'draft' });
  const writes = [
    () =>
      write('world_state', {
        worldStateId,
        kind: 'baseline',
        captureRef: 'vkcube_lavapipe.rdc',
        replay: { adapter: 'vk', driver: 'lavapipe', device: 'local' },
        shaderReplacement: null,
        patchStack: [],
        focus: { event: String(draw.event_id) },
        benchmark: {
          warmup: 0,
          resolution: `${target.width}x${target.height}`,
          vsync: false,
          samplingProtocol: 'none',
        },
        validity: 'valid',
      }),
    () => write('evidence', evidence('ev-tree', evidenceRef(tree), 'Action tree of the frame')),
    () => write('evidence', evidence('ev-pipeline', evidenceRef(pipeline), `Pipeline state at ${draw.event_id}`)),
    () => write('claim', treeClaim),
    () => write('claim', pipelineClaim),
    () =>
      write('report', {
        title: 'Frame structure',
        mission: 'debugger',
        summary: 'Answers read from the replay',
        claims: [projectClaim(treeClaim, 'report-tree'), projectClaim(pipelineClaim, 'report-pipeline')],
        evidenceIds: ['ev-tree', 'ev-pipeline'],
        experimentIds: [],
        // investigation_write answers `<artifactId>\t<kind>\t...`; the report links the two Claims it projects.
        reportContract: sampleReportContract(
          results.slice(5, 7).map((result) => (result.content[0] as { text: string }).text.split('\t')[0]!),
        ),
      }),
  ];
  const next = writes[results.length - 2];
  if (next) return next();
  const stageNames = stages.map((stage) => ({ Vertex: 'vertex', Pixel: 'pixel' })[stage] ?? stage).join(' and ');
  return [
    'Answers from the replay:',
    `Q1: ${draw.event_id}`,
    `Q2: ${draw.num_indices}`,
    `Q3: ${target.format}, ${target.width}x${target.height}`,
    `Q4: ${actions.length}`,
    `Q5: ${present.event_id}`,
    `Q6: ${stageNames}`,
  ].join('\n');
}

function scriptedProvider(): ProviderStrategy {
  return {
    api: MODEL.api,
    stream: (_model, context) => {
      const step = scriptedModel(context);
      const toolUse = typeof step !== 'string';
      const message: AssistantMessage = {
        role: 'assistant',
        content: toolUse ? [step] : [{ type: 'text', text: step }],
        model: MODEL.id,
        provider: MODEL.provider,
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        stopReason: toolUse ? 'toolUse' : 'stop',
        timestamp: Date.now(),
      };
      const stream = new EventStream<AssistantMessageEvent, AssistantMessage>();
      queueMicrotask(() => {
        stream.push({ type: 'done', reason: message.stopReason as 'toolUse' | 'stop', message });
        stream.complete(message);
      });
      return stream;
    },
  };
}

it('runs a scripted investigation turn through the agent runtime and commits a gradable session', async () => {
  const harness = createInvestigationHarness('rdc-eval-faux-', { sessionId: SESSION_ID });
  const lease = setRdcRuntimeContextForSession(
    SESSION_ID,
    {
      contextId: 'faux-context',
      runtimeOwner: 'faux',
      ownerLeaseId: 'faux-lease',
      backend: 'local',
      replaySessionId: 'faux-replay',
      captureFileId: 'faux-capture',
      updatedAt: 1,
    },
    { projectId: PROJECT_ID },
  )!;
  const toolContext = {
    sessionId: SESSION_ID,
    projectId: PROJECT_ID,
    workspaceRoot: harness.sessionPath,
    projectRootPath: harness.sessionPath,
    rdcBinding: freezeRdcTurnBinding(CLI_SETTINGS, [], lease),
    visionInputMode: 'native' as const,
  };
  const tools: AgentTool[] = [
    createRdcProbeTool(SESSION_ID, PROJECT_ID, { executeCli: replayCli(suite.faux.replay) }) as unknown as AgentTool,
    ...createInvestigationTools(SESSION_ID, { service: harness.service }),
  ];
  const user: Message = { role: 'user', content: suite.prompt.en!, timestamp: 1 };
  const loopMessages: Message[] = [user];
  const failures: string[] = [];
  const { stream } = agentLoop(
    [],
    {
      messages: [user],
      systemPrompt: '',
      runtime: { current: { revision: 1, activeTools: tools, activatedDeferredTools: new Set() } },
    },
    {
      model: MODEL,
      maxTurns: 12,
      convertToLlm: (items) => items as Message[],
      streamOptions: { requestPlan: REQUEST_PLAN },
    },
    scriptedProvider(),
    {
      // The product executor's presentation step: results are artifactized, pinned when the tool keeps evidence.
      execute: async (call) => {
        const tool = tools.find((item) => item.name === call.name)!;
        const executed = await tool.execute(call.id, call.arguments, undefined, undefined, toolContext);
        const result = artifactizeToolResult({
          sessionId: SESSION_ID,
          toolCallId: call.id,
          toolName: call.name,
          result: executed,
          resolver: harness.resolver,
          pinBelowThreshold: tool.spec.presentation?.pinEvidence?.(call.arguments, executed) === true,
        });
        if (result.isError === true) failures.push(`${call.name}: ${JSON.stringify(result.content)}`);
        return {
          role: 'toolResult',
          toolCallId: call.id,
          toolName: call.name,
          ...result,
          isError: result.isError === true,
          timestamp: Date.now(),
        };
      },
    },
  );
  for await (const event of stream) {
    if (event.type === 'error') throw (event as { error: unknown }).error;
    // The loop's own record of the turn: every assistant step and tool result, in order.
    if (event.type === 'agent_end') loopMessages.push(...event.messages.filter((message) => message.role !== 'user'));
  }
  expect(failures).toEqual([]);
  const final = loopMessages.at(-1) as AssistantMessage;
  expect(final.stopReason).toBe('stop');
  const answer = final.content.map((block) => (block.type === 'text' ? block.text : '')).join('');

  // The turn commits the way a finished turn does: one terminal append writes the assistant message and the
  // model-context entry together.
  const assistant: ConversationMessage = {
    id: 'assistant-1',
    requestId: 'request-1',
    turnId: 'turn-1',
    sessionId: SESSION_ID,
    projectId: PROJECT_ID,
    role: 'assistant',
    agentId: 'debugger',
    content: answer,
    status: 'complete',
    createdAt: 2,
    updatedAt: 3,
  };
  const contextEntry: SessionContextTurnEntry = {
    turnId: 'turn-1',
    userMessageId: 'user-1',
    assistantMessageId: assistant.id,
    branchId: 'root',
    agentId: 'debugger',
    executionIdentity: REQUEST_PLAN.executionIdentity,
    controls: { reasoningLevel: 'off', maxContextMode: false, fastModel: false },
    status: 'complete',
    messages: loopMessages,
    createdAt: 1,
    completedAt: 3,
  };
  const journal = prepareTerminalAppend(
    harness.sessionPath,
    'request-1',
    'turn-1',
    assistant,
    contextEntry,
    true,
    false,
  );
  applyTerminalAppend(harness.sessionPath, journal, true);

  const calls = loopMessages.flatMap((message) =>
    message.role === 'assistant' ? message.content.filter((block) => block.type === 'toolCall') : [],
  );
  expect(calls.map((call) => call.name)).toEqual([
    'rdc_probe',
    'rdc_probe',
    ...Array.from({ length: 6 }, () => 'investigation_write'),
  ]);
  expect(harness.service.list(SESSION_ID).map((item) => item.kind)).toEqual(
    expect.arrayContaining(['world_state', 'evidence', 'claim', 'report']),
  );
  const out = process.env.RDC_EVAL_FAUX_OUT;
  if (out) fs.cpSync(harness.sessionPath, out, { recursive: true });
  fs.rmSync(harness.sessionPath, { recursive: true, force: true });
});
