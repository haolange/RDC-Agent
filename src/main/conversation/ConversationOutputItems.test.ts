import { expect, it, vi } from 'vitest';
import { createAgentEventHandler, type AgentEventHandlerDeps, type TurnStreamState } from './ConversationTurnAgentEventHandler';
import type { AgentEvent } from '@shared/types/agentRuntime';
import type { ConversationMessage, ConversationWorkTrace } from '@shared/types/conversation';
import type { ProviderOutputRef } from '@shared/types/reasoning';

function fixture() {
  const state = {
    assistantMessage: { id: 'a', turnId: 'turn', role: 'assistant', content: '', createdAt: 1, updatedAt: 1 },
    currentLoopText: '', currentLoopProviderOutputRefs: [], loopHasTools: false,
    canonicalOutput: { finalAnswerText: '' }, visibleResponse: '',
  } as unknown as TurnStreamState;
  const commit = (_type: string, patch: Partial<ConversationMessage>) => { state.assistantMessage = { ...state.assistantMessage, ...patch }; };
  const deps = {
    host: { emitConversationEvent: vi.fn() }, sessionId: 'session',
    input: { preparedTurn: { runtime: { routeCapability: { reasoningDelivery: 'stream-full' } } } },
    turnStreamState: state, commitAssistantMessage: commit,
    commitVisibleAssistantText: () => {}, commitThinkingTrace: (workTrace: ConversationWorkTrace) => { state.assistantMessage.workTrace = workTrace; },
    beginAssistantContentLoop: () => {}, currentLoopId: () => 'loop',
    markLoopCommentary: () => { state.currentLoopOutputPhase = 'commentary'; },
    resolveStreamingOutputPhase: () => state.currentLoopOutputPhase,
    recordProviderOutputRefs: (refs: ProviderOutputRef[] = []) => { state.currentLoopProviderOutputRefs.push(...refs); },
    currentLoopOptions: () => ({ loopId: 'loop', loopResultText: state.currentLoopText }),
    pendingContinuation: { approval: false, userInput: false, planReview: false, handoff: false },
    hasPendingContinuation: () => false,
  } as unknown as AgentEventHandlerDeps;
  const handler = createAgentEventHandler(deps);
  const send = (type: AgentEvent['type'], payload: Record<string, unknown>) => handler({
    id: `event-${type}`, type, sessionId: 'session', timestamp: 1, payload,
  } as AgentEvent);
  return { state, send };
}

const ref = (index: number): ProviderOutputRef => ({ protocol: 'OpenAIResponses', providerBlockKey: `text:${index}`, contentIndex: index });

it('streams distinct text items after thinking and confirms only final items', () => {
  const { state, send } = fixture();
  const thinking = { kind: 'summary', source: 'anthropic-thinking', visibility: 'summary', text: 'Thinking' };
  send('assistant.thinking_end', { thinking, text: 'Thinking' });
  send('assistant.delta', { providerOutputRef: ref(0), text: 'Checking', phase: 'commentary' });
  send('assistant.delta', { providerOutputRef: ref(1), text: 'First ' });
  send('assistant.delta', { providerOutputRef: ref(1), text: 'answer' });
  const items = () => state.assistantMessage.workTrace!.blocks.find((block) => block.id === 'loop')!.outputItems!;
  expect(items().map((item) => item.text)).toEqual(['Checking', 'First answer']);
  expect(items()[1].phase).toBeUndefined();
  expect(state.canonicalOutput.finalAnswerText).toBe('');
  send('assistant.completed', { stopReason: 'end_turn', text: 'CheckingFirst answer', textItems: [
    { providerOutputRef: ref(0), text: 'Checking' },
    { providerOutputRef: ref(1), text: 'First answer' },
  ] });
  expect(items().map((item) => item.phase)).toEqual(['commentary', 'final_answer']);
  expect(state.canonicalOutput.finalAnswerText).toBe('First answer');
  expect(state.assistantMessage.workTrace!.blocks[0].result?.text).toBeUndefined();
});

it('resolves unknown text as commentary on a tool event without changing its position', () => {
  const { state, send } = fixture();
  send('assistant.delta', { providerOutputRef: ref(0), text: 'Checking' });
  const before = state.assistantMessage.workTrace!.blocks[0].outputItems![0];
  send('tool.requested', { toolCall: { id: 'tool', name: 'read_file', arguments: {} }, providerOutputRef: ref(1) });
  const after = state.assistantMessage.workTrace!.blocks[0].outputItems![0];
  expect(after).toMatchObject({ text: 'Checking', phase: 'commentary', displayOrder: before.displayOrder });
  expect(state.canonicalOutput.finalAnswerText).toBe('');
});

it('records visible thinking after an earlier text item without changing its order', () => {
  const { state, send } = fixture();
  send('assistant.delta', { providerOutputRef: ref(0), text: 'Earlier text' });
  send('assistant.thinking_end', { thinking: { kind: 'summary', source: 'anthropic-thinking',
    visibility: 'summary', text: 'Later thinking' }, text: 'Later thinking' });
  const loop = state.assistantMessage.workTrace!.blocks.find((block) => block.id === 'loop')!;
  expect(loop.outputItems![0].displayOrder).toBeLessThan(loop.thinkingDisplayOrder!);
});

it.each(['max_tokens', 'refusal', 'error', 'aborted'] as const)(
  'keeps a partial %s response out of the canonical final', (stopReason) => {
    const { state, send } = fixture();
    send('assistant.delta', { providerOutputRef: ref(0), text: 'Partial output' });
    send('assistant.completed', { stopReason, text: 'Partial output',
      textItems: [{ providerOutputRef: ref(0), text: 'Partial output' }] });
    const loop = state.assistantMessage.workTrace!.blocks.find((block) => block.id === 'loop')!;
    expect(loop.result?.stopReason).toBe(stopReason);
    expect(loop.outputItems?.[0]).toMatchObject({ text: 'Partial output', status: 'complete' });
    expect(state.canonicalOutput.finalAnswerText).toBe('');
  },
);
