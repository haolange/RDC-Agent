import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../sessions', () => ({
  rdxSessionService: { snapshotOpenedCaptureForSession: vi.fn(() => null) },
}));

vi.mock('../sessions/StorageAdapter', () => ({
  storageAdapter: {
    readSession: vi.fn(),
    listSessions: vi.fn(() => []),
    readConversationHistory: vi.fn(() => []),
    readConversationBranchState: vi.fn(() => null),
  },
}));

vi.mock('../workflow/debugger/AgentOrchestrator', () => ({
  agentOrchestrator: {
    releaseProviderRuntimeCredentials: vi.fn(),
    refreshProviderRuntimeCredentials: vi.fn(),
  },
}));

vi.mock('../agent-trace/TraceService', () => ({
  traceService: {
    buildConversationPresentation: vi.fn(async () => null),
  },
}));

import { conversationService } from './ConversationService';
import { storageAdapter } from '../sessions/StorageAdapter';

type IdempotentService = {
  runIdempotentTurn: (
    input: Record<string, unknown>,
    operation: (requestId: string, controller: AbortController) => Promise<unknown>,
  ) => Promise<unknown>;
  sendRequests: Map<string, Promise<unknown>>;
  sendRequestFingerprints: Map<string, string>;
  preparingRequests: Map<string, unknown>;
  activeSendScopes: Map<string, string>;
  acceptingTurns: boolean;
};

describe('ConversationService idempotency scoping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(storageAdapter.readSession).mockReturnValue(null);
    vi.mocked(storageAdapter.listSessions).mockReturnValue([]);
    vi.mocked(storageAdapter.readConversationHistory).mockReturnValue([]);
    const service = conversationService as unknown as IdempotentService;
    service.sendRequests.clear();
    service.sendRequestFingerprints.clear();
    service.preparingRequests.clear();
    service.activeSendScopes.clear();
    service.acceptingTurns = true;
  });

  it('does not share in-flight promises across sessions with the same requestId', async () => {
    const service = conversationService as unknown as IdempotentService;

    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = service.runIdempotentTurn(
      {
        requestId: 'shared-request',
        sessionId: 'session-a',
        projectId: 'project-a',
        mode: 'debugger',
        message: 'one',
        turnControls: { reasoningLevel: 'off', maxContextMode: false, fastModel: false },
      },
      async () => {
        await firstGate;
        return { requestId: 'shared-request', session: { sessionId: 'session-a' } };
      },
    );
    first.catch(() => undefined);

    // Allow microtasks from the async runIdempotentTurn prologue to settle.
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect([...service.sendRequests.keys()]).toEqual(['session:session-a:shared-request']);

    const second = service.runIdempotentTurn(
      {
        requestId: 'shared-request',
        sessionId: 'session-b',
        projectId: 'project-b',
        mode: 'debugger',
        message: 'two',
        turnControls: { reasoningLevel: 'off', maxContextMode: false, fastModel: false },
      },
      async () => ({ requestId: 'shared-request', session: { sessionId: 'session-b' } }),
    );
    second.catch(() => undefined);
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(service.sendRequests.has('session:session-a:shared-request')).toBe(true);
    expect(service.sendRequests.has('session:session-b:shared-request')).toBe(true);
    expect(service.sendRequests.get('session:session-a:shared-request')).not.toBe(
      service.sendRequests.get('session:session-b:shared-request'),
    );

    releaseFirst();
    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect((firstResult as { session: { sessionId: string } }).session.sessionId).toBe('session-a');
    expect((secondResult as { session: { sessionId: string } }).session.sessionId).toBe('session-b');
  });

  it('rejects same scoped requestId with a different fingerprint', async () => {
    const service = conversationService as unknown as IdempotentService;

    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const first = service.runIdempotentTurn(
      {
        requestId: 'req-1',
        sessionId: 'session-a',
        projectId: 'project-a',
        mode: 'debugger',
        message: 'alpha',
        turnControls: { reasoningLevel: 'off', maxContextMode: false, fastModel: false },
      },
      async () => {
        await gate;
        return { requestId: 'req-1' };
      },
    );
    first.catch(() => undefined);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect([...service.sendRequestFingerprints.keys()]).toEqual(['session:session-a:req-1']);

    await expect(service.runIdempotentTurn(
      {
        requestId: 'req-1',
        sessionId: 'session-a',
        projectId: 'project-a',
        mode: 'debugger',
        message: 'beta',
        turnControls: { reasoningLevel: 'off', maxContextMode: false, fastModel: false },
      },
      async () => ({ requestId: 'req-1' }),
    )).rejects.toThrow(/REQUEST_ID_CONFLICT/);

    release();
    await first;
  });

  it('registers preparingRequests before fingerprint hashing so Stop can abort', async () => {
    const service = conversationService as unknown as IdempotentService & {
      computeRequestFingerprint: (
        input: Record<string, unknown>,
        signal?: AbortSignal,
      ) => Promise<string>;
    };

    service.computeRequestFingerprint = async (_input, signal) => {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => resolve(), 10_000);
        signal?.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(new Error('TURN_CANCELLED: preparation aborted.'));
        });
      });
      return 'fp';
    };

    const pending = service.runIdempotentTurn(
      {
        requestId: 'req-stop-hash',
        sessionId: 'session-stop',
        projectId: 'project-stop',
        mode: 'debugger',
        message: 'hash-me',
        turnControls: { reasoningLevel: 'off', maxContextMode: false, fastModel: false },
      },
      async () => ({ requestId: 'req-stop-hash' }),
    );
    pending.catch(() => undefined);

    await vi.waitFor(() => {
      expect(service.preparingRequests.size).toBeGreaterThan(0);
    });

    const cancelled = await conversationService.cancelActiveTurn({ requestId: 'req-stop-hash' });
    expect(cancelled.success).toBe(true);
    await expect(pending).rejects.toThrow(/TURN_CANCELLED|aborted/);
    expect(service.preparingRequests.size).toBe(0);
  });
});
