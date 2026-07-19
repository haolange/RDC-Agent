import { describe, expect, it } from 'vitest';
import type { AgentMessage, AssistantMessage } from '../core/types';
import {
  buildDerivedContextView,
  computeContextSourceHash,
  createStructuredHandoffMessage,
} from './StructuredHandoffBuilder';

const assistant = (): AssistantMessage => ({
  role: 'assistant',
  content: [
    {
      type: 'thinking',
      text: 'private chain detail',
      kind: 'opaque',
      source: 'openai-responses-encrypted',
      visibility: 'hidden',
    },
    { type: 'text', text: 'Decision: inspect D:\\Captures\\scene.rdc next.' },
    { type: 'toolCall', id: 'call-1', name: 'read_file', arguments: { apiKey: 'tool-secret' } },
  ],
  model: 'model',
  provider: 'provider',
  usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
  stopReason: 'toolUse',
  timestamp: 2,
});

describe('StructuredHandoffBuilder', () => {
  it('creates a deterministic, typed, redacted projection without reasoning artifacts', () => {
    const messages: AgentMessage[] = [
      {
        role: 'user',
        content: 'Goal: inspect the capture. Must not leak api_key=\"secret-value\" or Authorization: Bearer bearer-secret. TODO: verify output.',
        timestamp: 1,
      },
      assistant(),
      {
        role: 'toolResult',
        toolCallId: 'call-1',
        toolName: 'read_file',
        content: [{ type: 'text', text: 'See https://example.test/result?access_token=url-secret and D:\\Captures\\scene.rdc' }],
        isError: false,
        timestamp: 3,
      },
    ];
    const before = structuredClone(messages);
    const options = {
      scope: 'session' as const,
      sessionId: 'session-1',
      branchId: 'branch-1',
      sourceTurnIds: ['turn-1'],
      retainedTurnIds: ['turn-2'],
      createdAt: 10,
      maxFactsPerGroup: 4,
      maxResourceRefs: 8,
    };
    const first = buildDerivedContextView(messages, options);
    const second = buildDerivedContextView(messages, options);
    const serialized = JSON.stringify(first.handoff);

    expect(first).toEqual(second);
    expect(messages).toEqual(before);
    expect(first.sourceHash).toBe(computeContextSourceHash(messages, ['turn-1']));
    expect(serialized).not.toContain('secret-value');
    expect(serialized).not.toContain('bearer-secret');
    expect(serialized).not.toContain('url-secret');
    expect(serialized).not.toContain('tool-secret');
    expect(serialized).not.toContain('private chain detail');
    expect(serialized).toContain('REDACTED');
    expect(first.handoff.resourceRefs).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'tool-call', value: 'read_file' }),
      expect.objectContaining({ kind: 'path', value: expect.stringContaining('scene.rdc') }),
    ]));

    const message = createStructuredHandoffMessage(first);
    expect(message.derivedContext).toEqual({
      viewId: first.viewId,
      handoffId: first.handoff.handoffId,
      sourceHash: first.sourceHash,
    });
    expect(message.content).toContain('[Derived context; not a user request]');
  });

  it('supports a minimal non-expanding projection candidate', () => {
    const view = buildDerivedContextView(
      [{ role: 'user', content: 'Objective only', timestamp: 1 }],
      { scope: 'ephemeral', createdAt: 1, maxFactsPerGroup: 0, maxResourceRefs: 0 },
    );
    expect(view.handoff.decisions).toEqual([]);
    expect(view.handoff.constraints).toEqual([]);
    expect(view.handoff.facts).toEqual([]);
    expect(view.handoff.openWork).toEqual([]);
    expect(view.handoff.resourceRefs).toEqual([]);
  });
});
