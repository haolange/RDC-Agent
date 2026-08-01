import { describe, expect, it } from 'vitest';
import type { AssistantMessage, ToolResultMessage } from '../core/types';
import {
  createToolRoundFingerprint,
  LoopProgressGuard,
} from './LoopProgressGuard';

function toolRound(args: Record<string, unknown> = {}): AssistantMessage {
  return {
    role: 'assistant',
    content: [{ type: 'toolCall', id: `call-${Math.random()}`, name: 'task_list', arguments: args }],
    model: 'test-model',
    provider: 'test-provider',
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    stopReason: 'toolUse',
    timestamp: Date.now(),
  };
}

function result(
  text = 'No tasks.',
  options: { isError?: boolean; details?: unknown; timestamp?: number } = {},
): ToolResultMessage {
  return {
    role: 'toolResult',
    toolCallId: `call-${Math.random()}`,
    toolName: 'task_list',
    content: [{ type: 'text', text }],
    isError: options.isError ?? false,
    details: options.details,
    timestamp: options.timestamp ?? Date.now(),
  };
}

describe('LoopProgressGuard', () => {
  it('injects guidance after the second identical round and terminates after the third', () => {
    const guard = new LoopProgressGuard();
    expect(guard.observe(toolRound(), [result()], 4).action).toBe('continue');
    expect(guard.observe(toolRound(), [result()], 4)).toMatchObject({
      action: 'inject-guidance',
      consecutiveMatches: 2,
    });
    expect(guard.observe(toolRound(), [result()], 4)).toMatchObject({
      action: 'terminate',
      consecutiveMatches: 3,
    });
  });

  it.each([
    ['arguments', toolRound({ status: 'pending' }), result(), 4],
    ['result', toolRound(), result('1 task'), 4],
    ['outcome', toolRound(), result('No tasks.', { isError: true }), 4],
    ['runtime revision', toolRound(), result(), 5],
  ])('resets when %s changes', (_label, changedRound, changedResult, revision) => {
    const guard = new LoopProgressGuard();
    guard.observe(toolRound(), [result()], 4);
    guard.observe(toolRound(), [result()], 4);
    expect(guard.observe(changedRound, [changedResult], revision)).toMatchObject({
      action: 'continue',
      consecutiveMatches: 1,
    });
  });

  it('ignores call ids and volatile timing metadata while retaining semantic details', () => {
    const first = createToolRoundFingerprint(
      toolRound({ filter: 'all' }),
      [result('No   tasks.\n', {
        timestamp: 1,
        details: { count: 0, durationMs: 12, updatedAt: 100 },
      })],
      2,
    );
    const second = createToolRoundFingerprint(
      toolRound({ filter: 'all' }),
      [result('No tasks.', {
        timestamp: 999,
        details: { count: 0, durationMs: 88, updatedAt: 900 },
      })],
      2,
    );
    expect(second).toBe(first);
  });
});
