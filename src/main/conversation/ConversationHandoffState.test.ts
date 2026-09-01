import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProfileHandoffState } from '@shared/types/profileHandoff';

const {
  cancelTurn,
  cancelUserInput,
  emitConversationEvent,
  startProfileTurn,
  handoffs,
} = vi.hoisted(() => ({
  cancelTurn: vi.fn(),
  cancelUserInput: vi.fn(),
  emitConversationEvent: vi.fn(),
  startProfileTurn: vi.fn(async () => ({ requestId: 'auto' })),
  handoffs: {
    getActive: vi.fn(),
    commit: vi.fn(),
    consume: vi.fn(),
    cancel: vi.fn(),
    hydrate: vi.fn(),
    isLiveThisProcess: vi.fn(),
  },
}));

vi.mock('../sessions', () => ({
  rdxSessionService: { snapshotOpenedCaptureForSession: vi.fn(() => null) },
}));

vi.mock('../sessions/StorageAdapter', () => ({
  storageAdapter: {
    handoffs,
    readSession: vi.fn(() => ({
      sessionId: 'sess_1',
      projectId: 'proj_1',
      title: 't',
      goal: '',
      sessionPath: 'D:/sess',
      createdAt: 1,
      updatedAt: 1,
    })),
    updateSession: vi.fn((sessionId: string, patch: { agentId?: string }) => ({
      sessionId,
      projectId: 'proj_1',
      title: 't',
      goal: '',
      sessionPath: 'D:/sess',
      createdAt: 1,
      updatedAt: 1,
      ...patch,
    })),
    listRuns: vi.fn(() => []),
    getLatestRun: vi.fn(() => null),
    listProjectInputs: vi.fn(async () => []),
    getCurrentProjectId: vi.fn(() => 'proj_1'),
    getCurrentSessionId: vi.fn(async () => 'sess_1'),
    readConversationHistory: vi.fn(() => []),
    listSessions: vi.fn(() => []),
    readConversationBranchState: vi.fn(() => null),
  },
}));

vi.mock('../agent-runtime/permissions/AgentToolApprovalRequestService', () => ({
  agentToolApprovalRequestService: { cancelTurn, answer: vi.fn() },
}));

vi.mock('../agent-runtime/interactions/AgentUserInputRequestService', () => ({
  agentUserInputRequestService: { cancelTurn: cancelUserInput, answer: vi.fn() },
}));

vi.mock('./ConversationTurnTerminal', () => ({
  persistConversationSnapshot: vi.fn(),
  assertTerminalContextOwnership: vi.fn(),
  emitConversationEvent,
  publishConversationTrace: vi.fn(),
  publishTraceProjection: vi.fn(),
  ephemeralTraceSessionId: (turnId: string) => `eph-${turnId}`,
}));

vi.mock('../captures/ReplayDeviceService', () => ({
  replayDeviceService: {
    getDeviceById: vi.fn(() => ({ id: 'local' })),
  },
}));

import { conversationService } from './ConversationService';
import { settleSourceHandoffAfterTerminal } from './ConversationTurnRunner';
import { projectSessionForClient } from '../sessions/projectSessionHandoff';

const committed: ProfileHandoffState = {
  handoffId: 'handoff-1',
  lifecycle: 'committed',
  sourceTurnId: 'turn-src',
  sourceRequestId: 'req-src',
  sourceAgentId: 'plan',
  toAgentId: 'edit',
  chainRoot: 'root-1',
  depth: 1,
  prompt: 'Implement the plan.',
  label: 'Implement',
  declaredModel: null,
  send: true,
  preparedAt: 1,
  committedAt: 2,
};

describe('ConversationService durable handoff wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    handoffs.getActive.mockReturnValue(committed);
    handoffs.cancel.mockImplementation((_sessionId: string, reason: string) => {
      handoffs.getActive.mockReturnValue(null);
      return {
        ...committed,
        lifecycle: 'cancelled',
        cancelReason: reason,
      };
    });
    handoffs.consume.mockImplementation(() => {
      handoffs.getActive.mockReturnValue(null);
      return {
        ...committed,
        lifecycle: 'consumed',
        consumedAt: 3,
      };
    });
    handoffs.isLiveThisProcess.mockReturnValue(true);
    const service = conversationService as unknown as {
      autoSendHandoffSessions: Set<string>;
      preparingRequests: Map<string, unknown>;
      activeSendScopes: Map<string, string>;
      startProfileTurn: typeof startProfileTurn;
      startHandoffAutoSend: (sessionId: string) => Promise<void>;
      scheduleHandoffAutoSend: (sessionId: string) => void;
    };
    service.autoSendHandoffSessions.clear();
    service.preparingRequests.clear();
    service.activeSendScopes.clear();
    service.startProfileTurn = startProfileTurn;
  });

  it('does not auto-send a committed+send handoff after process restart', async () => {
    handoffs.isLiveThisProcess.mockReturnValue(false);
    const service = conversationService as unknown as {
      scheduleHandoffAutoSend: (sessionId: string) => void;
      startHandoffAutoSend: (sessionId: string) => Promise<void>;
    };
    service.scheduleHandoffAutoSend('sess_1');
    await service.startHandoffAutoSend('sess_1');
    expect(startProfileTurn).not.toHaveBeenCalled();
  });

  it('cancels unfinished handoff on Stop and does not inherit approvals', () => {
    conversationService.cancelUnfinishedHandoff('sess_1', 'user_stop');
    expect(handoffs.cancel).toHaveBeenCalledWith('sess_1', 'user_stop');
    expect(cancelTurn).toHaveBeenCalledWith('turn-src');
    expect(cancelUserInput).toHaveBeenCalledWith('turn-src');
    expect(emitConversationEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: 'agent_event',
      event: expect.objectContaining({ type: 'handoff.cancelled' }),
    }));
  });

  it('cancels unfinished handoff on Rewrite and Agent switch', () => {
    conversationService.cancelUnfinishedHandoff('sess_1', 'rewrite');
    conversationService.cancelUnfinishedHandoff('sess_1', 'manual_switch');
    expect(handoffs.cancel).toHaveBeenNthCalledWith(1, 'sess_1', 'rewrite');
    expect(handoffs.cancel).toHaveBeenNthCalledWith(2, 'sess_1', 'manual_switch');
  });

  it('clears source-turn approvals when consuming the target turn', () => {
    const service = conversationService as unknown as {
      consumeCommittedHandoff: (sessionId: string, handoff: ProfileHandoffState) => void;
    };
    cancelTurn.mockClear();
    service.consumeCommittedHandoff('sess_1', committed);
    expect(handoffs.consume).toHaveBeenCalledWith('sess_1', 'handoff-1', undefined);
    expect(cancelTurn).toHaveBeenCalledWith('turn-src');
    expect(cancelUserInput).toHaveBeenCalledWith('turn-src');
    expect(emitConversationEvent).toHaveBeenCalledWith(expect.objectContaining({
      event: expect.objectContaining({ type: 'handoff.consumed' }),
    }));
  });

  it('emits restart_degrade and never auto-sends after hydrate', () => {
    conversationService.notifyHydratedHandoff('sess_1', {
      ...committed,
      lifecycle: 'cancelled',
      cancelReason: 'restart_degrade',
    });
    expect(emitConversationEvent).toHaveBeenCalledWith(expect.objectContaining({
      event: expect.objectContaining({
        type: 'handoff.cancelled',
        payload: expect.objectContaining({ cancelReason: 'restart_degrade' }),
      }),
    }));
    expect(startProfileTurn).not.toHaveBeenCalled();
  });

  it('writes SessionRecord.agentId on consume', async () => {
    const { storageAdapter } = await import('../sessions/StorageAdapter');
    const service = conversationService as unknown as {
      consumeCommittedHandoff: (sessionId: string, handoff: ProfileHandoffState) => void;
    };
    service.consumeCommittedHandoff('sess_1', committed);
    expect(storageAdapter.updateSession).toHaveBeenCalledWith('sess_1', { agentId: 'edit' });
  });

  it('cancels prepared when persistConversationSnapshot returns an error', () => {
    const host = {
      commitPreparedHandoff: vi.fn(),
      cancelUnfinishedHandoff: vi.fn(),
      scheduleHandoffAutoSend: vi.fn(),
      emitConversationEvent: vi.fn(),
    };
    settleSourceHandoffAfterTerminal(host as never, {
      terminalCommitted: false,
      assistantStatus: 'error',
      sessionId: 'sess_1',
      sourceTurnId: 'turn-src',
      pendingHandoff: {
        turnId: 'turn-src',
        fromAgentId: 'plan',
        toProfile: 'edit',
        prompt: 'Implement the plan.',
        label: 'Implement',
        sessionId: 'sess_1',
      },
    });
    expect(host.cancelUnfinishedHandoff).toHaveBeenCalledWith('sess_1', 'superseded');
    expect(host.commitPreparedHandoff).not.toHaveBeenCalled();
    expect(host.scheduleHandoffAutoSend).not.toHaveBeenCalled();
  });

  it('cancels prepared when the source turn ends in error', () => {
    const host = {
      commitPreparedHandoff: vi.fn(),
      cancelUnfinishedHandoff: vi.fn(),
      scheduleHandoffAutoSend: vi.fn(),
      emitConversationEvent: vi.fn(),
    };
    settleSourceHandoffAfterTerminal(host as never, {
      terminalCommitted: true,
      assistantStatus: 'error',
      sessionId: 'sess_1',
      sourceTurnId: 'turn-src',
      pendingHandoff: {
        turnId: 'turn-src',
        fromAgentId: 'plan',
        toProfile: 'edit',
        prompt: 'Implement the plan.',
        label: 'Implement',
        sessionId: 'sess_1',
      },
    });
    expect(host.cancelUnfinishedHandoff).toHaveBeenCalledWith('sess_1', 'superseded');
    expect(host.commitPreparedHandoff).not.toHaveBeenCalled();
    expect(host.scheduleHandoffAutoSend).not.toHaveBeenCalled();
  });

  it('does not commit or auto-send when commitConversationTerminal throws', () => {
    const host = {
      commitPreparedHandoff: vi.fn(),
      cancelUnfinishedHandoff: vi.fn(),
      scheduleHandoffAutoSend: vi.fn(),
      emitConversationEvent: vi.fn(),
    };
    settleSourceHandoffAfterTerminal(host as never, {
      terminalCommitted: false,
      assistantStatus: 'error',
      sessionId: 'sess_1',
      sourceTurnId: 'turn-src',
      pendingHandoff: {
        turnId: 'turn-src',
        fromAgentId: 'plan',
        toProfile: 'edit',
        prompt: 'Implement the plan.',
        label: 'Implement',
        sessionId: 'sess_1',
      },
    });
    expect(host.commitPreparedHandoff).not.toHaveBeenCalled();
    expect(host.scheduleHandoffAutoSend).not.toHaveBeenCalled();
    expect(host.cancelUnfinishedHandoff).toHaveBeenCalledWith('sess_1', 'superseded');
  });

  it('cancels auto-send during committing without consuming', async () => {
    const service = conversationService as unknown as {
      preparingRequests: Map<string, {
        requestId: string;
        controller: AbortController;
        phase: 'preparing' | 'committing';
        scopeKey: string;
        cancelAfterCommit: boolean;
        credentialLeaseTransferred: boolean;
      }>;
      consumeCommittedHandoff: (sessionId: string, handoff: ProfileHandoffState) => void;
    };
    const controller = new AbortController();
    service.preparingRequests.set('session:sess_1:req-auto', {
      requestId: 'req-auto',
      controller,
      phase: 'committing',
      scopeKey: 'session:sess_1',
      cancelAfterCommit: false,
      credentialLeaseTransferred: false,
    });
    const result = await conversationService.cancelActiveTurn({ sessionId: 'sess_1' });
    expect(result).toMatchObject({
      success: true,
      phase: 'committing',
      cancelledRequestId: 'req-auto',
    });
    expect(controller.signal.aborted).toBe(true);
    expect(service.preparingRequests.get('session:sess_1:req-auto')?.cancelAfterCommit).toBe(true);
    expect(handoffs.cancel).toHaveBeenCalledWith('sess_1', 'user_stop');
    expect(handoffs.getActive('sess_1')).toBeNull();
    service.consumeCommittedHandoff('sess_1', committed);
    expect(handoffs.consume).not.toHaveBeenCalled();
  });

  it('cancels a committed handoff when Stop hits the target preparing phase', async () => {
    const service = conversationService as unknown as {
      preparingRequests: Map<string, {
        requestId: string;
        controller: AbortController;
        phase: 'preparing' | 'committing';
        scopeKey: string;
        cancelAfterCommit: boolean;
        credentialLeaseTransferred: boolean;
      }>;
    };
    const controller = new AbortController();
    service.preparingRequests.set('session:sess_1:req-target', {
      requestId: 'req-target',
      controller,
      phase: 'preparing',
      scopeKey: 'session:sess_1',
      cancelAfterCommit: false,
      credentialLeaseTransferred: false,
    });
    const result = await conversationService.cancelActiveTurn({ sessionId: 'sess_1' });
    expect(result).toMatchObject({ success: true, phase: 'preparing', cancelledRequestId: 'req-target' });
    expect(controller.signal.aborted).toBe(true);
    expect(handoffs.cancel).toHaveBeenCalledWith('sess_1', 'user_stop');
  });

  it('cancels committed send:true when auto-send preflight fails on an unavailable route', async () => {
    startProfileTurn.mockRejectedValueOnce(new Error('PROVIDER_UNAVAILABLE: target route is not available.'));
    const service = conversationService as unknown as {
      autoSendHandoffSessions: Set<string>;
      startHandoffAutoSend: (sessionId: string) => Promise<void>;
    };
    service.autoSendHandoffSessions.add('sess_1');
    await service.startHandoffAutoSend('sess_1');
    expect(startProfileTurn).toHaveBeenCalled();
    expect(handoffs.consume).not.toHaveBeenCalled();
    expect(handoffs.cancel).toHaveBeenCalledWith('sess_1', 'invalid_model');
    expect(handoffs.getActive('sess_1')).toBeNull();
  });

  it('does not cancel after successful auto-send consume', async () => {
    const service = conversationService as unknown as {
      autoSendHandoffSessions: Set<string>;
      startHandoffAutoSend: (sessionId: string) => Promise<void>;
      consumeCommittedHandoff: (sessionId: string, handoff: ProfileHandoffState) => void;
    };
    startProfileTurn.mockImplementationOnce(async () => {
      service.consumeCommittedHandoff('sess_1', committed);
      return { requestId: 'auto' };
    });
    service.autoSendHandoffSessions.add('sess_1');
    await service.startHandoffAutoSend('sess_1');
    expect(handoffs.consume).toHaveBeenCalledWith('sess_1', 'handoff-1', undefined);
    expect(handoffs.cancel).not.toHaveBeenCalled();
  });

  it('cancels prepared when commitPreparedHandoff returns null', () => {
    const host = {
      commitPreparedHandoff: vi.fn(() => null),
      cancelUnfinishedHandoff: vi.fn(),
      scheduleHandoffAutoSend: vi.fn(),
      emitConversationEvent: vi.fn(),
    };
    settleSourceHandoffAfterTerminal(host as never, {
      terminalCommitted: true,
      assistantStatus: 'complete',
      sessionId: 'sess_1',
      sourceTurnId: 'turn-src',
      pendingHandoff: {
        turnId: 'turn-src',
        fromAgentId: 'plan',
        toProfile: 'edit',
        prompt: 'Implement the plan.',
        label: 'Implement',
        sessionId: 'sess_1',
      },
    });
    expect(host.cancelUnfinishedHandoff).toHaveBeenCalledWith('sess_1', 'superseded');
    expect(host.scheduleHandoffAutoSend).not.toHaveBeenCalled();
  });

  it('registers auto-send on the shared preparing path so Stop can abort it', async () => {
    const service = conversationService as unknown as {
      preparingRequests: Map<string, { controller: AbortController; scopeKey: string }>;
      autoSendHandoffSessions: Set<string>;
      startHandoffAutoSend: (sessionId: string) => Promise<void>;
    };
    let sawPreparing = false;
    startProfileTurn.mockImplementation(async (...args: unknown[]) => {
      sawPreparing = service.preparingRequests.size > 0;
      const controller = args[9] as AbortController;
      if (controller.signal.aborted) {
        throw new Error('TURN_CANCELLED: preparation aborted.');
      }
      await new Promise<never>((_resolve, reject) => {
        controller.signal.addEventListener('abort', () => {
          reject(new Error('TURN_CANCELLED: preparation aborted.'));
        });
      });
      return { requestId: 'auto' };
    });
    service.autoSendHandoffSessions.add('sess_1');
    const pending = service.startHandoffAutoSend('sess_1');
    await vi.waitFor(() => {
      expect(startProfileTurn).toHaveBeenCalled();
    });
    expect(sawPreparing).toBe(true);
    expect([...service.preparingRequests.values()][0]?.scopeKey).toBe('session:sess_1');
    const result = await conversationService.cancelActiveTurn({ sessionId: 'sess_1' });
    expect(result).toMatchObject({ success: true, phase: 'preparing' });
    expect(handoffs.cancel).toHaveBeenCalledWith('sess_1', 'user_stop');
    await pending;
  });

  it('projects toAgentId for select/hydrate while committed handoff is unconsumed', () => {
    expect(projectSessionForClient({
      sessionId: 'sess_1',
      projectId: 'proj_1',
      title: 't',
      goal: '',
      sessionPath: 'D:/sess',
      createdAt: 1,
      updatedAt: 1,
      agentId: 'plan',
    }).agentId).toBe('edit');
  });
});
