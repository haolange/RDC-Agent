import { describe, expect, it } from 'vitest';
import { EventStream } from '../../core/EventStream';
import type { AssistantMessage, AssistantMessageEvent } from '../../core/types';
import { AssistantStreamBuilder, ProviderStreamProtocolError } from './AssistantStreamBuilder';
import {
  AlternatingTextThinkingChannels,
  StreamChannelRefs,
  closeSwitchedChannel,
} from './streamChannelRefs';

function makeBuilder() {
  const stream = new EventStream<AssistantMessageEvent, AssistantMessage>(
    (event) => event.type === 'done',
    (event) => (event as Extract<AssistantMessageEvent, { type: 'done' }>).message,
  );
  const builder = new AssistantStreamBuilder(stream, 'model', 'provider');
  builder.start();
  return { builder, stream };
}

describe('StreamChannelRefs', () => {
  it('memoizes refs by stable key and assigns unique contentIndex values', () => {
    const channels = new StreamChannelRefs('openai-responses');
    const first = channels.ref({ providerBlockKey: 'output:reasoning:0', sourceIndex: 0, itemId: 'rs_1' });
    const same = channels.ref({ providerBlockKey: 'output:reasoning:0', sourceIndex: 0, itemId: 'rs_1' });
    const second = channels.ref({ providerBlockKey: 'output:reasoning:1', sourceIndex: 1, itemId: 'rs_2' });
    const tool = channels.ref({ providerBlockKey: 'output:tool:2', sourceIndex: 2, itemId: 'fc_1' });

    expect(same).toBe(first);
    expect(new Set([first.contentIndex, second.contentIndex, tool.contentIndex]).size).toBe(3);
    expect(first.providerBlockKey).toBe('output:reasoning:0');
    expect(second.providerBlockKey).toBe('output:reasoning:1');
  });

  it('closes the previous alternating segment and opens a new ref after a kind switch', () => {
    const { builder } = makeBuilder();
    const alternating = new AlternatingTextThinkingChannels(new StreamChannelRefs('openai-compatible'));

    const firstThinking = alternating.ensure('thinking');
    expect(firstThinking.started).toBe(true);
    builder.startThinking(firstThinking.ref);
    builder.appendThinking(firstThinking.ref, 'one');

    const text = alternating.ensure('text');
    closeSwitchedChannel(builder, text.close);
    expect(text.started).toBe(true);
    builder.startText(text.ref);
    builder.appendText(text.ref, 'hello');

    const secondThinking = alternating.ensure('thinking');
    closeSwitchedChannel(builder, secondThinking.close);
    expect(secondThinking.started).toBe(true);
    expect(secondThinking.ref.providerBlockKey).not.toBe(firstThinking.ref.providerBlockKey);
    expect(secondThinking.ref.contentIndex).not.toBe(firstThinking.ref.contentIndex);
    builder.startThinking(secondThinking.ref);
    builder.appendThinking(secondThinking.ref, 'two');

    expect(() => builder.appendThinking(firstThinking.ref, 'late')).toThrowError(
      expect.objectContaining({ code: 'PROVIDER_STREAM_BLOCK_CLOSED' }) as ProviderStreamProtocolError,
    );
  });
});
