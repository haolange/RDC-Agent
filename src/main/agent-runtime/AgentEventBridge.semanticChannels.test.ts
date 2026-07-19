import { describe, expect, it } from 'vitest';
import type {
  AssistantMessage,
  AssistantMessageEvent,
  ProviderOutputRef,
  ThinkingContent,
  ToolCall,
} from './core/types';
import { translateCoreToSharedAgentEvent } from './AgentEventBridge';

const textRef: ProviderOutputRef = {
  protocol: 'test',
  responseId: 'response-1',
  providerBlockKey: 'text:0',
  sourceIndex: 0,
  contentIndex: 0,
};
const thinkingRef: ProviderOutputRef = {
  protocol: 'test',
  responseId: 'response-1',
  providerBlockKey: 'thinking:0',
  sourceIndex: 1,
  contentIndex: 1,
};
const toolRef: ProviderOutputRef = {
  protocol: 'test',
  responseId: 'response-1',
  providerBlockKey: 'tool:0',
  sourceIndex: 2,
  itemId: 'call-1',
  contentIndex: 2,
};
const thinking: ThinkingContent = {
  type: 'thinking',
  text: 'reasoning',
  kind: 'raw',
  source: 'openai-compatible-raw',
  visibility: 'raw-collapsed',

  providerOutputRef: thinkingRef,
};
const toolCall: ToolCall = {
  type: 'toolCall',
  id: 'call-1',
  name: 'read_file',
  arguments: { path: 'README.md' },
  providerOutputRef: toolRef,
};
const message: AssistantMessage = {
  role: 'assistant',
  content: [
    { type: 'text', text: 'answer', providerOutputRef: textRef },
    thinking,
    toolCall,
  ],
  model: 'model',
  provider: 'provider',
  usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
  stopReason: 'stop',
  timestamp: 1,
};

describe('AgentEventBridge semantic channel refs', () => {
  it('preserves text, thinking, and tool source refs on shared events', () => {
    const textEvent: AssistantMessageEvent = {
      type: 'text_delta',
      contentIndex: 0,
      delta: 'answer',
      providerOutputRef: textRef,
      partial: message,
    };
    const thinkingEvent: AssistantMessageEvent = {
      type: 'thinking_end',
      contentIndex: 1,
      content: 'reasoning',
      thinking,
      providerOutputRef: thinkingRef,
      partial: message,
    };
    const toolEvent: AssistantMessageEvent = {
      type: 'toolcall_end',
      contentIndex: 2,
      toolCall,
      providerOutputRef: toolRef,
      partial: message,
    };

    const textShared = translateCoreToSharedAgentEvent({
      type: 'message_update',
      assistantMessageEvent: textEvent,
      message,
    }, {});
    const thinkingShared = translateCoreToSharedAgentEvent({
      type: 'message_update',
      assistantMessageEvent: thinkingEvent,
      message,
    }, {});
    const toolShared = translateCoreToSharedAgentEvent({
      type: 'message_update',
      assistantMessageEvent: toolEvent,
      message,
    }, {});
    const completedShared = translateCoreToSharedAgentEvent({
      type: 'message_end',
      message,
    }, {});

    expect(textShared?.payload.providerOutputRef).toEqual(textRef);
    expect((thinkingShared?.payload.thinking as { providerOutputRef?: ProviderOutputRef }).providerOutputRef).toEqual(thinkingRef);
    expect(toolShared?.payload.providerOutputRef).toEqual(toolRef);
    expect(completedShared?.payload.providerOutputRefs).toEqual([textRef]);
    expect((completedShared?.payload.thinking as Array<{ providerOutputRef?: ProviderOutputRef }>)[0]?.providerOutputRef)
      .toEqual(thinkingRef);
  });
});