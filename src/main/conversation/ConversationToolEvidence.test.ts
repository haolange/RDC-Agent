import { describe, expect, it } from 'vitest';
import type { ConversationWorkTrace } from '@shared/types/conversation';
import {
  attachToolExecutionEvidence,
  deriveToolExecutionEvidence,
} from './ConversationToolEvidence';

const TRACE: ConversationWorkTrace = {
  status: 'running',
  updatedAt: 1,
  blocks: [{
    id: 'loop-1',
    kind: 'llm_turn',
    title: 'Loop',
    status: 'running',
    startedAt: 1,
    toolCalls: [
      { id: 'ok', toolName: 'read_file', status: 'complete', startedAt: 1, completedAt: 2 },
      { id: 'failed', toolName: 'shell', status: 'error', error: 'exit 1', startedAt: 2, completedAt: 3 },
      { id: 'pending', toolName: 'task_list', status: 'pending', startedAt: 3 },
      { id: 'running', toolName: 'web_search', status: 'running', startedAt: 4 },
    ],
    children: [{
      id: 'child',
      kind: 'llm_turn',
      title: 'Child',
      status: 'complete',
      startedAt: 1,
      completedAt: 2,
      toolCalls: [
        { id: 'child-ok', toolName: 'grep', status: 'complete', startedAt: 1, completedAt: 2 },
        // Repeated projection of the same call must not inflate product evidence.
        { id: 'ok', toolName: 'read_file', status: 'complete', startedAt: 1, completedAt: 2 },
      ],
    }],
  }],
};

describe('ConversationToolEvidence', () => {
  it('derives success, failure, and skipped counts from actual tool statuses', () => {
    expect(deriveToolExecutionEvidence(TRACE)).toEqual({
      total: 5,
      succeeded: 2,
      failed: 1,
      skipped: 2,
    });
  });

  it('attaches an immutable structured projection without changing tool evidence', () => {
    const attached = attachToolExecutionEvidence(TRACE);
    expect(attached).not.toBe(TRACE);
    expect(attached.toolEvidence).toEqual({
      total: 5,
      succeeded: 2,
      failed: 1,
      skipped: 2,
    });
    expect(attached.blocks).toBe(TRACE.blocks);
  });
});
