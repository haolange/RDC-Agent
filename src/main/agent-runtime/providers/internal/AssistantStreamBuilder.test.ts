import { describe, expect, it } from 'vitest';
import { EventStream } from '../../core/EventStream';
import type { AssistantMessage, AssistantMessageEvent } from '../../core/types';
import {
  AssistantStreamBuilder,
  createProviderOutputRef,
  ProviderStreamProtocolError,
} from './AssistantStreamBuilder';

function makeBuilder() {
  const stream = new EventStream<AssistantMessageEvent, AssistantMessage>(
    (event) => event.type === 'done',
    (event) => (event as Extract<AssistantMessageEvent, { type: 'done' }>).message,
  );
  const builder = new AssistantStreamBuilder(stream, 'model', 'provider');
  builder.start();
  return { builder, stream };
}

const textRef = createProviderOutputRef({
  protocol: 'test',
  providerBlockKey: 'text:0',
  sourceIndex: 0,
  contentIndex: 0,
});
const thinkingRef = createProviderOutputRef({
  protocol: 'test',
  providerBlockKey: 'thinking:0',
  sourceIndex: 1,
  contentIndex: 1,
});
const toolRef = createProviderOutputRef({
  protocol: 'test',
  providerBlockKey: 'tool:0',
  sourceIndex: 2,
  itemId: 'call-1',
  contentIndex: 2,
});

describe('AssistantStreamBuilder channel invariant', () => {
  it('preserves ordered typed blocks and allows identical bytes from distinct explicit sources', async () => {
    const { builder, stream } = makeBuilder();
    builder.startThinking(thinkingRef, {
      kind: 'raw',
      source: 'openai-compatible-raw',
      visibility: 'raw-collapsed',
      replayPolicy: 'none',
    });
    builder.appendThinking(thinkingRef, 'same bytes');
    builder.endThinking(thinkingRef);
    builder.startText(textRef);
    builder.appendText(textRef, 'same bytes');
    builder.endText(textRef);
    builder.startToolCall(toolRef, 'call-1', 'read_file');
    builder.appendToolCallArgs(toolRef, '{"path":"README.md"}');
    builder.endToolCall(toolRef);
    builder.done('toolUse');

    const message = await stream.result();
    expect(message.content.map((block) => block.type)).toEqual(['thinking', 'text', 'toolCall']);
    expect(message.content[0]?.providerOutputRef?.providerBlockKey).toBe('thinking:0');
    expect(message.content[1]?.providerOutputRef?.providerBlockKey).toBe('text:0');

    const events: AssistantMessageEvent[] = [];
    for await (const event of stream) events.push(event);
    const thinkingDelta = events.find((event) => event.type === 'thinking_delta');
    const textDelta = events.find((event) => event.type === 'text_delta');
    const toolEnd = events.find((event) => event.type === 'toolcall_end');
    expect(thinkingDelta?.providerOutputRef.providerBlockKey).toBe('thinking:0');
    expect(thinkingDelta?.thinking.providerOutputRef?.providerBlockKey).toBe('thinking:0');
    expect(textDelta?.providerOutputRef.providerBlockKey).toBe('text:0');
    expect(toolEnd?.providerOutputRef.providerBlockKey).toBe('tool:0');
  });

  it('fails closed when one source ref changes semantic channel', () => {
    const { builder } = makeBuilder();
    builder.startText(textRef);
    expect(() => builder.startThinking(textRef, {
      kind: 'raw',
      source: 'unknown',
      visibility: 'raw-collapsed',
      replayPolicy: 'none',
    })).toThrowError(expect.objectContaining({
      code: 'PROVIDER_STREAM_CHANNEL_COLLISION',
    }) as ProviderStreamProtocolError);
  });

  it('rejects a delta before block start', () => {
    const { builder } = makeBuilder();
    expect(() => builder.appendText(textRef, 'late')).toThrowError(expect.objectContaining({
      code: 'PROVIDER_STREAM_DELTA_BEFORE_START',
    }) as ProviderStreamProtocolError);
  });

  it('rejects writes after block close', () => {
    const { builder } = makeBuilder();
    builder.startText(textRef);
    builder.endText(textRef);
    expect(() => builder.appendText(textRef, 'late')).toThrowError(expect.objectContaining({
      code: 'PROVIDER_STREAM_BLOCK_CLOSED',
    }) as ProviderStreamProtocolError);
  });

  it('rejects semantic events after terminal', () => {
    const { builder } = makeBuilder();
    builder.startText(textRef);
    builder.appendText(textRef, 'done');
    builder.done('stop');
    expect(() => builder.appendText(textRef, 'late')).toThrowError(expect.objectContaining({
      code: 'PROVIDER_STREAM_EVENT_AFTER_TERMINAL',
    }) as ProviderStreamProtocolError);
  });

  it('rejects two source refs claiming the same emitted content index', () => {
    const { builder } = makeBuilder();
    builder.startText(textRef);
    const collidingRef = createProviderOutputRef({
      protocol: 'test',
      providerBlockKey: 'thinking:other',
      sourceIndex: 99,
      contentIndex: textRef.contentIndex,
    });
    expect(() => builder.startThinking(collidingRef, {
      kind: 'raw',
      source: 'unknown',
      visibility: 'raw-collapsed',
      replayPolicy: 'none',
    })).toThrowError(expect.objectContaining({
      code: 'PROVIDER_STREAM_CHANNEL_COLLISION',
    }) as ProviderStreamProtocolError);
  });
});
