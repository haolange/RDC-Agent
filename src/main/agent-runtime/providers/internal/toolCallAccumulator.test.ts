import { describe, expect, it } from 'vitest';
import { EventStream } from '../../core/EventStream';
import { AssistantStreamBuilder, type ProviderStreamProtocolError } from './AssistantStreamBuilder';
import { StreamChannelRefs } from './streamChannelRefs';
import { ToolCallAccumulator } from './toolCallAccumulator';
import type { AssistantMessage, AssistantMessageEvent } from '../../core/types';

function setup() {
  const stream = new EventStream<AssistantMessageEvent, AssistantMessage>(
    (event) => event.type === 'done',
    (event) => (event as Extract<AssistantMessageEvent, { type: 'done' }>).message,
  );
  const builder = new AssistantStreamBuilder(stream, 'model', 'provider');
  builder.start();
  const channels = new StreamChannelRefs('test');
  const refFor = (key: string) => channels.ref({ providerBlockKey: `tool:${key}`, itemId: key });
  const finishedToolCalls = async () => {
    builder.markTerminal('toolUse');
    builder.finish({ signal: new AbortController().signal, sawOutput: true, providerApi: 'test' });
    return (await stream.result()).content.filter((block) => block.type === 'toolCall');
  };
  return { refFor, toolCalls: new ToolCallAccumulator<string>(builder), finishedToolCalls };
}

describe('ToolCallAccumulator', () => {
  it('starts a call on first sight, fills a missing id later and assembles streamed argument fragments', async () => {
    const { refFor, toolCalls, finishedToolCalls } = setup();
    toolCalls.open('a', refFor('a'), '', 'read_file');
    toolCalls.open('a', refFor('a'), 'call-a', 'ignored');
    toolCalls.appendArguments('a', refFor('a'), '{"path":');
    toolCalls.appendArguments('a', refFor('a'), '');
    toolCalls.appendArguments('a', refFor('a'), '"a.rdc"}');
    toolCalls.close('a', refFor('a'));

    expect(toolCalls.isOpen('a')).toBe(false);
    expect(toolCalls.count).toBe(1);
    expect(await finishedToolCalls()).toEqual([
      expect.objectContaining({ id: 'call-a', name: 'read_file', arguments: { path: 'a.rdc' } }),
    ]);
  });

  it('tells which calls still lack arguments, so a closing frame repeats whole arguments only where none streamed', () => {
    const { refFor, toolCalls } = setup();
    toolCalls.start('streamed', refFor('streamed'), 'call-1', 'read_file');
    toolCalls.appendArguments('streamed', refFor('streamed'), '{"path":"a.rdc"}');
    toolCalls.start('whole', refFor('whole'), 'call-2', 'read_file');
    toolCalls.appendArguments('whole', refFor('whole'), '');

    expect(toolCalls.hasArguments('streamed')).toBe(true);
    expect(toolCalls.hasArguments('whole')).toBe(false);
    expect(toolCalls.isOpen('whole')).toBe(true);
  });

  it('delivers a call that arrives whole in one frame as started, filled and closed', async () => {
    const { refFor, toolCalls, finishedToolCalls } = setup();
    toolCalls.addComplete('0', refFor('0'), 'call-0', 'inspect', '{"event":19}');

    expect(toolCalls.isOpen('0')).toBe(false);
    expect(await finishedToolCalls()).toEqual([
      expect.objectContaining({ id: 'call-0', name: 'inspect', arguments: { event: 19 } }),
    ]);
  });

  it('leaves a second announcement or a fragment for a closed call to the builder as protocol violations', () => {
    const { refFor, toolCalls } = setup();
    toolCalls.start('a', refFor('a'), 'call-a', 'read_file');

    expect(() => toolCalls.start('a', refFor('a'), 'call-a', 'read_file')).toThrowError(
      expect.objectContaining({ code: 'PROVIDER_STREAM_DUPLICATE_BLOCK_START' }) as ProviderStreamProtocolError,
    );
    toolCalls.close('a', refFor('a'));
    expect(() => toolCalls.appendArguments('a', refFor('a'), '{}')).toThrowError(
      expect.objectContaining({ code: 'PROVIDER_STREAM_BLOCK_CLOSED' }) as ProviderStreamProtocolError,
    );
  });
});
