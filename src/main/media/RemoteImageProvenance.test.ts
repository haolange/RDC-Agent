import { describe, expect, it } from 'vitest';
import { RemoteImageProvenance, normalizeRemoteImageUrl } from './RemoteImageProvenance';
import type { ConversationMessage } from '@shared/types/conversation';

const message = (input: Partial<ConversationMessage> & Pick<ConversationMessage, 'id' | 'role'>): ConversationMessage =>
  ({
    turnId: 't',
    sessionId: 's',
    projectId: null,
    content: '',
    status: 'complete',
    createdAt: 1,
    updatedAt: 1,
    ...input,
  }) as ConversationMessage;

const toolCall = (toolName: string, resultPreview: string) => ({
  id: `call-${toolName}`,
  toolName,
  status: 'complete',
  argsPreview: '{"url":"https://model.example/args.png"}',
  resultPreview,
});

const assistant = (id: string, content: string, calls: ReturnType<typeof toolCall>[] = []) =>
  message({
    id,
    role: 'assistant',
    content,
    workTrace: {
      status: 'complete',
      updatedAt: 1,
      blocks: [{ id: `${id}-block`, kind: 'llm_turn', title: 'turn', status: 'complete', toolCalls: calls }],
    },
  } as never);

describe('RemoteImageProvenance', () => {
  it('trusts URLs the person wrote or a web or knowledge tool returned, not URLs the model wrote', () => {
    let history: ConversationMessage[] = [
      message({ id: 'u1', role: 'user', content: 'Compare with https://user.example/ref.png, please.' }),
      assistant('a1', 'See ![shot](https://model.example/made-up.png)', [
        toolCall('web_fetch', '{"images":["https://web.example/fetched.png#top"]}'),
        toolCall('knowledge_read', 'Reference: https://kb.example/case.png'),
        toolCall('write_file', 'wrote https://model.example/laundered.png'),
      ]),
    ];
    const provenance = new RemoteImageProvenance(() => history);
    expect(provenance.isFromNonModelSource('s', 'https://user.example/ref.png')).toBe(true);
    expect(provenance.isFromNonModelSource('s', 'https://web.example/fetched.png')).toBe(true);
    expect(provenance.isFromNonModelSource('s', 'https://kb.example/case.png')).toBe(true);
    expect(provenance.isFromNonModelSource('s', 'https://model.example/made-up.png')).toBe(false);
    expect(provenance.isFromNonModelSource('s', 'https://model.example/args.png')).toBe(false);
    expect(provenance.isFromNonModelSource('s', 'https://model.example/laundered.png')).toBe(false);

    history = [
      ...history,
      message({
        id: 'u2',
        role: 'user',
        content: 'Also https://model.example/made-up.png',
        createdAt: 2,
        updatedAt: 2,
      }),
    ];
    expect(provenance.isFromNonModelSource('s', 'https://model.example/made-up.png')).toBe(true);
  });

  it('compares https URLs without fragments or trailing punctuation and rejects other schemes', () => {
    expect(normalizeRemoteImageUrl('https://Example.com/a.png#x.')).toBe('https://example.com/a.png');
    expect(normalizeRemoteImageUrl('http://example.com/a.png')).toBeNull();
  });
});
