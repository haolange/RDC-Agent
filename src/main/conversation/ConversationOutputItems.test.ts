import { expect, it, vi } from 'vitest';

vi.mock('../runtime/RuntimeLogService', () => ({ runtimeLogService: { log: vi.fn() } }));
import {
  createAgentEventHandler,
  type AgentEventTurn,
  type TurnStreamState,
} from './ConversationTurnAgentEventHandler';
import type { AgentEventPayloadMap, AgentEventType } from '@shared/types/agentRuntime';
import type { ConversationMessage, ConversationWorkTrace } from '@shared/types/conversation';
import type { ProviderOutputRef, ThinkingArtifact } from '@shared/types/reasoning';

type AgentEventInput = { [T in AgentEventType]: { type: T; payload: AgentEventPayloadMap[T] } }[AgentEventType];

function fixture() {
  const state = {
    assistantMessage: { id: 'a', turnId: 'turn', role: 'assistant', content: '', createdAt: 1, updatedAt: 1 },
    currentLoopText: '',
    currentLoopProviderOutputRefs: [],
    loopHasTools: false,
    loopSeq: 1,
    pendingNewLoop: false,
  } as unknown as TurnStreamState & { loopSeq: number };
  const commit = (_type: string, patch: Partial<ConversationMessage>) => {
    state.assistantMessage = { ...state.assistantMessage, ...patch };
  };
  const deps = {
    host: { emitConversationEvent: vi.fn() },
    sessionId: 'session',
    input: {
      context: { projectId: 'project', currentRun: null },
      preparedTurn: { runtime: { routeCapability: { reasoningDelivery: 'stream-full' } } },
    },
    turnStreamState: state,
    commitAssistantMessage: commit,
    commitThinkingTrace: (workTrace: ConversationWorkTrace) => {
      state.assistantMessage.workTrace = workTrace;
    },
    beginAssistantContentLoop: () => {
      if (!state.pendingNewLoop) return;
      state.loopSeq += 1;
      state.pendingNewLoop = false;
      state.currentLoopOutputPhase = undefined;
      state.currentLoopText = '';
      state.currentLoopProviderOutputRefs = [];
      state.loopHasTools = false;
    },
    currentLoopId: () => (state.loopSeq === 1 ? 'loop' : `loop-${state.loopSeq}`),
    markLoopCommentary: () => {
      state.currentLoopOutputPhase = 'commentary';
    },
    resolveStreamingOutputPhase: () => state.currentLoopOutputPhase,
    recordProviderOutputRefs: (refs: ProviderOutputRef[] = []) => {
      state.currentLoopProviderOutputRefs.push(...refs);
    },
    currentLoopOptions: () => ({
      loopId: deps.currentLoopId(),
      loopProviderOutputRefs: state.currentLoopProviderOutputRefs,
    }),
    pendingContinuation: { approval: false, userInput: false, planReview: false, handoff: false },
  } as unknown as AgentEventTurn;
  const handler = createAgentEventHandler(deps);
  const send = (input: AgentEventInput) =>
    handler({ id: `event-${input.type}`, sessionId: 'session', timestamp: 1, ...input });
  return { state, send };
}

const ref = (index: number): ProviderOutputRef => ({
  protocol: 'OpenAIResponses',
  providerBlockKey: `text:${index}`,
  contentIndex: index,
});
const thinkingRef = (index: number): ProviderOutputRef => ({
  protocol: 'OpenAIResponses',
  providerBlockKey: `thinking:${index}`,
  contentIndex: index,
});
const loopBlock = (state: TurnStreamState) =>
  state.assistantMessage.workTrace!.blocks.find((block) => block.id === 'loop')!;
const textItems = (state: TurnStreamState) => loopBlock(state).items!.filter((item) => item.kind === 'text');

it('keeps a provider answer followed by host continuation out of the published reply', () => {
  const { state, send } = fixture();
  const attempted = { providerOutputRef: ref(0), text: 'Execution was interrupted.', phase: 'final_answer' as const };
  send({
    type: 'assistant.completed',
    payload: { text: attempted.text, stopReason: 'end_turn', textItems: [attempted] },
  });
  send({
    type: 'assistant.delta',
    payload: { providerOutputRef: ref(0), text: 'Checking the replay.', phase: 'commentary' },
  });
  send({
    type: 'tool.requested',
    payload: { toolCall: { id: 'probe', name: 'rdc_probe', arguments: {} }, providerOutputRef: ref(1) },
  });
  const loops = state.assistantMessage.workTrace!.blocks.filter((block) => block.kind === 'llm_turn');
  expect(loops.map((block) => block.toolCalls.length)).toEqual([0, 1]);
  expect(loops[1].items?.[0]).toMatchObject({ text: 'Checking the replay.', phase: 'commentary' });
  expect(state.assistantMessage.content).toBe('');
});

it('streams distinct text items after thinking and confirms only final items', () => {
  const { state, send } = fixture();
  const thinking: ThinkingArtifact = {
    kind: 'summary',
    source: 'anthropic-thinking',
    visibility: 'summary',
    text: 'Thinking',
  };
  send({ type: 'assistant.thinking_end', payload: { thinking, text: 'Thinking', providerOutputRef: thinkingRef(9) } });
  send({ type: 'assistant.delta', payload: { providerOutputRef: ref(0), text: 'Checking', phase: 'commentary' } });
  send({ type: 'assistant.delta', payload: { providerOutputRef: ref(1), text: 'First ' } });
  send({ type: 'assistant.delta', payload: { providerOutputRef: ref(1), text: 'answer' } });
  const items = () => textItems(state);
  expect(items().map((item) => item.text)).toEqual(['Checking', 'First answer']);
  expect(items()[1].phase).toBeUndefined();
  expect(state.assistantMessage.content).toBe('');
  send({
    type: 'assistant.completed',
    payload: {
      stopReason: 'end_turn',
      text: 'CheckingFirst answer',
      textItems: [
        { providerOutputRef: ref(0), text: 'Checking' },
        { providerOutputRef: ref(1), text: 'First answer' },
      ],
    },
  });
  expect(items().map((item) => item.phase)).toEqual(['commentary', 'final_answer']);
  expect(state.assistantMessage.content).toBe('');
  expect(state.pendingNewLoop).toBe(true);
});

it('resolves unknown text as commentary on a tool event without changing its position', () => {
  const { state, send } = fixture();
  send({ type: 'assistant.delta', payload: { providerOutputRef: ref(0), text: 'Checking' } });
  const before = textItems(state)[0];
  send({
    type: 'tool.requested',
    payload: { toolCall: { id: 'tool', name: 'read_file', arguments: {} }, providerOutputRef: ref(1) },
  });
  const after = textItems(state)[0];
  expect(after).toMatchObject({ text: 'Checking', phase: 'commentary', displayOrder: before.displayOrder });
  expect(state.assistantMessage.content).toBe('');
});

it('records visible thinking after an earlier text item without changing its order', () => {
  const { state, send } = fixture();
  send({ type: 'assistant.delta', payload: { providerOutputRef: ref(0), text: 'Earlier text' } });
  send({
    type: 'assistant.thinking_end',
    payload: {
      thinking: { kind: 'summary', source: 'anthropic-thinking', visibility: 'summary', text: 'Later thinking' },
      text: 'Later thinking',
      providerOutputRef: thinkingRef(1),
    },
  });
  expect(loopBlock(state).items!.map((item) => item.kind)).toEqual(['text', 'thinking']);
});

it('keeps every thinking block of a loop in place instead of the last one replacing the first', () => {
  const { state, send } = fixture();
  const summary = (text: string): ThinkingArtifact => ({
    kind: 'summary',
    source: 'anthropic-thinking',
    visibility: 'summary',
    text,
  });
  send({
    type: 'assistant.thinking_delta',
    payload: { thinking: summary('Plan the read'), text: 'Plan the read', providerOutputRef: thinkingRef(0) },
  });
  send({
    type: 'assistant.thinking_end',
    payload: { thinking: summary('Plan the read'), text: 'Plan the read', providerOutputRef: thinkingRef(0) },
  });
  send({
    type: 'tool.requested',
    payload: { toolCall: { id: 'tool', name: 'read_file', arguments: {} }, providerOutputRef: ref(1) },
  });
  send({ type: 'tool.started', payload: { toolCallId: 'tool', toolName: 'read_file', args: {} } });
  send({
    type: 'assistant.thinking_end',
    payload: {
      thinking: summary('Check what came back'),
      text: 'Check what came back',
      providerOutputRef: thinkingRef(2),
    },
  });
  const thinkingItems = loopBlock(state).items!.filter((item) => item.kind === 'thinking');
  expect(thinkingItems.map((item) => item.kind === 'thinking' && item.thinking.text)).toEqual([
    'Plan the read',
    'Check what came back',
  ]);
  expect(thinkingItems.map((item) => item.status)).toEqual(['complete', 'complete']);
  const toolOrder = loopBlock(state).toolCalls[0].displayOrder!;
  expect(thinkingItems[0].displayOrder).toBeLessThan(toolOrder);
  expect(thinkingItems[1].displayOrder).toBeGreaterThan(toolOrder);
});

it.each(['max_tokens', 'refusal', 'error', 'aborted'] as const)(
  'keeps a partial %s response out of the canonical final',
  (stopReason) => {
    const { state, send } = fixture();
    send({ type: 'assistant.delta', payload: { providerOutputRef: ref(0), text: 'Partial output' } });
    send({
      type: 'assistant.completed',
      payload: {
        stopReason,
        text: 'Partial output',
        textItems: [{ providerOutputRef: ref(0), text: 'Partial output' }],
      },
    });
    const loop = state.assistantMessage.workTrace!.blocks.find((block) => block.id === 'loop')!;
    expect(loop.result?.stopReason).toBe(stopReason);
    expect(loop.items?.[0]).toMatchObject({ kind: 'text', text: 'Partial output', status: 'complete' });
    expect(state.assistantMessage.content).toBe('');
  },
);

it("drops a failed attempt's partial text and undeclared tools when the provider request is retried", () => {
  const { state, send } = fixture();
  send({ type: 'assistant.delta', payload: { providerOutputRef: ref(0), text: 'Half of an ans' } });
  send({
    type: 'tool.requested',
    payload: { toolCall: { id: 'never-run', name: 'read_file', arguments: {} }, providerOutputRef: ref(1) },
  });
  send({
    type: 'diagnostic',
    payload: { code: 'error_recovery_retry', phase: 'started', severity: 'info', message: 'Retrying' },
  });
  expect(loopBlock(state).items ?? []).toEqual([]);
  expect(loopBlock(state).toolCalls).toEqual([]);
  send({
    type: 'assistant.delta',
    payload: { providerOutputRef: { ...ref(0), responseId: 'retry' }, text: 'A whole answer' },
  });
  send({
    type: 'assistant.completed',
    payload: {
      stopReason: 'end_turn',
      text: 'A whole answer',
      textItems: [{ providerOutputRef: { ...ref(0), responseId: 'retry' }, text: 'A whole answer' }],
    },
  });
  expect(textItems(state).map((item) => item.text)).toEqual(['A whole answer']);
  expect(state.assistantMessage.content).toBe('');
});
