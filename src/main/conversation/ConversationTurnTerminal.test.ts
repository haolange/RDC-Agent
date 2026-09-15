import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConversationMessage } from '@shared/types/conversation';
import type { ConversationBranchState } from '@shared/types/conversationBranch';
import { ROOT_BRANCH_ID } from '@shared/types/conversationBranch';

const storage = vi.hoisted(() => ({
  readConversationHistory: vi.fn(),
  readConversationBranchState: vi.fn(),
}));
vi.mock('../sessions/StorageAdapter', () => ({ storageAdapter: storage }));
vi.mock('../workflow/debugger/WorkflowProjectionPublisher', () => ({ workflowProjectionPublisher: {} }));
vi.mock('../agent-trace/TraceService', () => ({ traceService: {} }));

import { assertTerminalContextOwnership } from './ConversationTurnTerminal';

function message(id: string, role: 'user' | 'assistant', turnId: string, createdAt: number): ConversationMessage {
  return { id, role, turnId, createdAt, branchId: 'branch-edit', content: '' } as ConversationMessage;
}

describe('terminal context branch ownership', () => {
  let history: ConversationMessage[];
  let branches: ConversationBranchState;
  const validate = () => assertTerminalContextOwnership('session', 'followup', 'user', 'assistant', 'branch-edit');

  beforeEach(() => {
    history = [
      message('anchor', 'user', 'rewrite', 10),
      message('anchor-answer', 'assistant', 'rewrite', 11),
      message('user', 'user', 'followup', 20),
      message('assistant', 'assistant', 'followup', 21),
    ];
    branches = {
      sessionId: 'session', rootBranchId: ROOT_BRANCH_ID, activeLeafBranchId: 'branch-edit',
      forks: [{
        forkId: 'fork', anchorMessageId: 'original-user', activeBranchId: 'branch-edit',
        branches: [{ branchId: 'branch-edit', parentBranchId: ROOT_BRANCH_ID, variantIndex: 1,
          anchorUserMessageId: 'anchor', rootTurnId: 'rewrite' }],
      }],
    };
    storage.readConversationHistory.mockImplementation(() => history);
    storage.readConversationBranchState.mockImplementation(() => branches);
  });

  it('accepts the first rewritten turn and subsequent turns on the same branch', () => {
    expect(() => assertTerminalContextOwnership('session', 'rewrite', 'anchor', 'anchor-answer', 'branch-edit')).not.toThrow();
    expect(validate).not.toThrow();
  });

  it('accepts an owning background turn after the visible branch changes', () => {
    branches.activeLeafBranchId = ROOT_BRANCH_ID;
    branches.forks[0].activeBranchId = ROOT_BRANCH_ID;
    expect(validate).not.toThrow();
  });

  it.each(['user', 'assistant'])('rejects a %s message moved to another branch', (id) => {
    history.find((entry) => entry.id === id)!.branchId = ROOT_BRANCH_ID;
    expect(validate).toThrow('message ownership changed');
  });

  it('rejects a message reassigned to another turn', () => {
    history[3].turnId = 'other';
    expect(validate).toThrow('message ownership changed');
  });

  it('rejects a removed branch', () => {
    branches.forks = [];
    expect(validate).toThrow('branch ownership changed');
  });

  it('rejects a missing anchor', () => {
    history = history.filter((entry) => entry.id !== 'anchor');
    expect(validate).toThrow('branch ownership changed');
  });

  it.each(['turn', 'branch', 'role', 'time'])('rejects inconsistent anchor %s', (field) => {
    if (field === 'turn') history[0].turnId = 'other';
    if (field === 'branch') history[0].branchId = ROOT_BRANCH_ID;
    if (field === 'role') history[0].role = 'assistant';
    if (field === 'time') history[0].createdAt = 30;
    expect(validate).toThrow('branch ownership changed');
  });

  it('keeps root branch turns independent of fork metadata', () => {
    history[2].branchId = ROOT_BRANCH_ID;
    history[3].branchId = ROOT_BRANCH_ID;
    expect(() => assertTerminalContextOwnership('session', 'followup', 'user', 'assistant', ROOT_BRANCH_ID)).not.toThrow();
  });
});
