import { describe, expect, it, vi } from 'vitest';
import { ConversationStreamPatchScheduler, type ConversationStreamPatchCommit } from './ConversationStreamPatchScheduler';

describe('ConversationStreamPatchScheduler', () => {
  it('batches text patches and skips trace projection for token deltas', () => {
    vi.useFakeTimers();
    let now = 1_000;
    const commits: ConversationStreamPatchCommit[] = [];
    const scheduler = new ConversationStreamPatchScheduler({
      now: () => now,
      commit: (commit) => commits.push(commit),
      textFlushMs: 48,
      persistFlushMs: 600,
    });

    scheduler.queueText({ status: 'streaming', content: 'a' });
    scheduler.queueText({ status: 'streaming', content: 'ab' });
    expect(commits).toHaveLength(0);

    vi.advanceTimersByTime(48);

    expect(commits).toEqual([
      {
        type: 'message_patched',
        patch: { status: 'streaming', content: 'ab' },
        options: { persist: true, publishTrace: false },
      },
    ]);

    now += 100;
    scheduler.queueText({ status: 'streaming', content: 'abc' });
    vi.advanceTimersByTime(48);

    expect(commits[1]).toEqual({
      type: 'message_patched',
      patch: { status: 'streaming', content: 'abc' },
      options: { persist: false, publishTrace: false },
    });

    scheduler.close();
    vi.useRealTimers();
  });

  it('forces pending text and trace patches before terminal commits', () => {
    vi.useFakeTimers();
    const commits: ConversationStreamPatchCommit[] = [];
    const scheduler = new ConversationStreamPatchScheduler({
      now: () => 2_000,
      commit: (commit) => commits.push(commit),
      textFlushMs: 48,
      traceFlushMs: 48,
    });

    scheduler.queueText({ status: 'streaming', content: 'partial' });
    scheduler.queueTrace({ workTrace: { status: 'running', blocks: [], updatedAt: 2_000 } });
    scheduler.commitTerminal('message_completed', { status: 'complete', content: 'final' });

    expect(commits.map((commit) => commit.options.persist)).toEqual([true, true, true]);
    expect(commits.map((commit) => commit.type)).toEqual([
      'message_patched',
      'message_patched',
      'message_completed',
    ]);
    expect(commits[2].patch).toEqual({ status: 'complete', content: 'final' });

    vi.advanceTimersByTime(500);
    expect(commits).toHaveLength(3);

    vi.useRealTimers();
  });
});
