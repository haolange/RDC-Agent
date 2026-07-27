import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../sessions', () => ({
  rdxSessionService: { snapshotOpenedCaptureForSession: vi.fn(() => null) },
}));

import type { ConversationMessage } from '@shared/types/conversation';
import { createDefaultBranchState } from './ConversationBranchResolver';
import { conversationService } from './ConversationService';
import { sessionContextJournal, type SessionContextTurnEntry } from './SessionContextJournal';
import { storageAdapter } from '../sessions/StorageAdapter';

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
  it('persists a context view without rewriting the canonical transcript', async () => {
    const history = [
      message('user-1', 'turn-1', 'user', 'Inspect the capture.', 1),
      message('assistant-1', 'turn-1', 'assistant', 'Found event 42.', 2),
      message('user-2', 'turn-2', 'user', 'Continue.', 3),
      message('assistant-2', 'turn-2', 'assistant', 'Done.', 4),
    ];
    vi.spyOn(storageAdapter, 'readConversationHistory').mockReturnValue(history);
    vi.spyOn(storageAdapter, 'readConversationBranchState')
      .mockReturnValue(createDefaultBranchState('session-1'));
    const writeHistory = vi.spyOn(storageAdapter, 'writeConversationHistory');
    vi.spyOn(sessionContextJournal, 'readEntries').mockReturnValue([
      { turnId: 'turn-1' } as SessionContextTurnEntry,
      { turnId: 'turn-2' } as SessionContextTurnEntry,
    ]);
    const createView = vi.spyOn(sessionContextJournal, 'createDerivedView').mockReturnValue(null);

    const result = await conversationService.compactHistory('session-1');

    expect(result.messages).toBe(history);
    expect(result.contextView).toBeNull();
    expect(createView).toHaveBeenCalledWith(
      'session-1',
      ['turn-1', 'turn-2'],
      'branch-root',
    );
    expect(writeHistory).not.toHaveBeenCalled();
  });
});
