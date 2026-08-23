import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../sessions', () => ({
  rdxSessionService: { snapshotOpenedCaptureForSession: vi.fn(() => null) },
}));
vi.mock('./ConversationTurnTerminal', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./ConversationTurnTerminal')>();
  return {
    ...actual,
    publishConversationTrace: vi.fn(),
    publishTraceProjection: vi.fn(),
  };
});

import type { ConversationMessage } from '@shared/types/conversation';
import { createDefaultBranchState } from './ConversationBranchResolver';
import { conversationService } from './ConversationService';
import { sessionContextJournal, type SessionContextTurnEntry } from './SessionContextJournal';
import { storageAdapter } from '../sessions/StorageAdapter';
import * as compactionHandoff from '../agent-runtime/context/CompactionHandoffService';
import type { DerivedContextView } from '@shared/types/semanticContext';

afterEach(() => vi.restoreAllMocks());

const message = (
  id: string,
  turnId: string,
  role: ConversationMessage['role'],
  content: string,
  createdAt: number,
): ConversationMessage => ({
  id,
  turnId,
  sessionId: 'session-1',
  projectId: 'project-1',
  role,
  content,
  createdAt,
  branchId: 'branch-root',
});

describe('ConversationService derived compaction', () => {
  it('does not record a completed compaction when occupancy is within the threshold', async () => {
    const history = [
      message('user-1', 'turn-1', 'user', 'Inspect the capture.', 1),
      message('assistant-1', 'turn-1', 'assistant', 'Found event 42.', 2),
      message('user-2', 'turn-2', 'user', 'Continue.', 3),
      message('assistant-2', 'turn-2', 'assistant', 'Done.', 4),
    ];
    vi.spyOn(storageAdapter, 'readConversationHistory').mockReturnValue(history);
    vi.spyOn(storageAdapter, 'readConversationBranchState')
      .mockReturnValue(createDefaultBranchState('session-1'));
    vi.spyOn(storageAdapter, 'readSessionUsage').mockReturnValue(null);
    const writeHistory = vi.spyOn(storageAdapter, 'writeConversationHistory').mockImplementation(() => undefined);
    vi.spyOn(sessionContextJournal, 'readEntries').mockReturnValue([
      { turnId: 'turn-1' } as SessionContextTurnEntry,
      { turnId: 'turn-2' } as SessionContextTurnEntry,
    ]);
    const createView = vi.spyOn(sessionContextJournal, 'createDerivedView').mockReturnValue(null);

    const result = await conversationService.compactHistory('session-1');

    expect(result.status).toBe('noop');
    expect(result.messages).toBe(history);
    expect(result.contextView).toBeNull();
    expect(createView).toHaveBeenCalledWith(
      'session-1',
      ['turn-1', 'turn-2'],
      'branch-root',
      { occupiedTokens: 0, compactionThresholdTokens: 0 },
      3,
    );
    expect(writeHistory).not.toHaveBeenCalled();
    expect(history[3]?.workTrace).toBeUndefined();
  });

  it('records a manual compaction work block only after a model-generated view exists', async () => {
    const history = [
      message('user-1', 'turn-1', 'user', 'Inspect the capture.', 1),
      message('assistant-1', 'turn-1', 'assistant', 'Found event 42.', 2),
      message('user-2', 'turn-2', 'user', 'Continue.', 3),
      message('assistant-2', 'turn-2', 'assistant', 'Done.', 4),
      message('user-3', 'turn-3', 'user', 'Next.', 5),
      message('assistant-3', 'turn-3', 'assistant', 'Working.', 6),
      message('user-4', 'turn-4', 'user', 'Again.', 7),
      message('assistant-4', 'turn-4', 'assistant', 'Still working.', 8),
    ];
    const view = {
      schemaVersion: 1,
      viewId: 'context-view-1',
      scope: 'session',
      sessionId: 'session-1',
      branchId: 'branch-root',
      sourceTurnIds: ['turn-1'],
      retainedTurnIds: ['turn-2', 'turn-3', 'turn-4'],
      sourceHash: 'hash',
      createdAt: 1,
      handoff: {
        schemaVersion: 1,
        handoffId: 'handoff-1',
        kind: 'derived-compaction',
        derivation: 'model-generated',
        objective: 'Inspect the capture.',
        decisions: [],
        constraints: [],
        facts: [],
        openWork: [],
        resourceRefs: [],
        source: { turnIds: ['turn-1'], messageCount: 1, messageHashes: ['h'], sourceHash: 'hash' },
        contentHash: 'content',
      },
    } as DerivedContextView;
    vi.spyOn(storageAdapter, 'readConversationHistory').mockReturnValue(history);
    vi.spyOn(storageAdapter, 'readConversationBranchState')
      .mockReturnValue(createDefaultBranchState('session-1'));
    vi.spyOn(storageAdapter, 'readSessionUsage').mockReturnValue({
      occupiedTokens: 180_000,
      compactionThresholdTokens: 160_000,
    } as never);
    const writeHistory = vi.spyOn(storageAdapter, 'writeConversationHistory').mockImplementation(() => undefined);
    vi.spyOn(sessionContextJournal, 'readEntries').mockReturnValue([
      { turnId: 'turn-1' },
      { turnId: 'turn-2' },
      { turnId: 'turn-3' },
      { turnId: 'turn-4' },
    ] as SessionContextTurnEntry[]);
    vi.spyOn(compactionHandoff, 'persistGeneratedSessionCompaction').mockResolvedValue(view);

    const result = await conversationService.compactHistory('session-1');

    expect(result.status).toBe('compacted');
    expect(result.contextView).toBe(view);
    expect(writeHistory).toHaveBeenCalled();
    expect(history[7]?.workTrace).toEqual(expect.objectContaining({
      blocks: expect.arrayContaining([
        expect.objectContaining({ kind: 'compaction', title: '手动压缩', status: 'complete' }),
      ]),
    }));
  });
});
