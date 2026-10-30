import { describe, expect, it, vi } from 'vitest';
import type { AgentPermissionMode } from '@shared/types/settings';
import type { AgentPermissionDecision } from './AgentPermissionPolicy';
import { RuntimePermissionStateService } from './RuntimePermissionStateService';
import { executeWithPermissionAdmission } from './ToolPermissionAdmission';
import { AgentToolApprovalRequestService } from './AgentToolApprovalRequestService';
import { ToolResourceArbiter } from '../../workflow/debugger/ToolResourceArbiter';
import type { AgentEvent } from '@shared/types/agentRuntime';

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
const allow: AgentPermissionDecision = { action: 'allow', risk: 'low', temporaryPathRoots: [] };
const modes: AgentPermissionMode[] = ['default', 'auto-review', 'full-access', 'custom'];

describe('main-owned permission state', () => {
  it('fails closed before initialization; initializes once and commits real changes only', () => {
    const state = new RuntimePermissionStateService();
    expect(() => state.getSnapshot()).toThrow('UNINITIALIZED');
    const listener = vi.fn();
    const stop = state.subscribe(listener);
    expect(state.initialize('default')).toEqual({ mode: 'default', revision: 1 });
    expect(state.initialize('full-access').mode).toBe('default');
    state.commitMode('default');
    expect(listener).not.toHaveBeenCalled();
    state.commitMode('full-access'); state.commitMode('default');
    expect(state.getSnapshot()).toEqual({ mode: 'default', revision: 3 });
    expect(listener).toHaveBeenCalledTimes(2);
    stop(); state.commitMode('custom');
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('does not let a failing observer undo a committed mode or starve other observers', () => {
    const state = new RuntimePermissionStateService(); state.initialize('default');
    state.subscribe(() => { throw new Error('observer failure'); });
    const listener = vi.fn(); state.subscribe(listener);
    expect(state.commitMode('custom').mode).toBe('custom');
    expect(listener).toHaveBeenCalledOnce();
  });
});

describe('final tool permission admission', () => {
  it.each(modes.flatMap(from => modes.filter(to => to !== from).map(to => ({ from, to }))))('reauthorizes $from → $to after the hook without repeating it', async ({ from, to }) => {
    const state = new RuntimePermissionStateService(); state.initialize(from);
    const hookEntered = deferred(); const hookResume = deferred();
    const authorize = vi.fn(async () => allow);
    const beforeExecute = vi.fn(async () => { hookEntered.resolve(); await hookResume.promise; });
    const execute = vi.fn(async (_decision, snapshot) => snapshot);
    const result = executeWithPermissionAdmission({ state, authorize, beforeExecute, execute, assertLive: () => {}, withResource: operation => operation() });
    await hookEntered.promise;
    state.commitMode(to); hookResume.resolve();
    expect(await result).toEqual({ mode: to, revision: 2 });
    expect(authorize).toHaveBeenCalledTimes(2);
    expect(beforeExecute).toHaveBeenCalledOnce(); expect(execute).toHaveBeenCalledOnce();
  });

  it('releases project and global claims before reauthorization while an admitted operation keeps its snapshot', async () => {
    const state = new RuntimePermissionStateService(); state.initialize('full-access');
    const arbiter = new ToolResourceArbiter(); const running = deferred(); const started = deferred();
    const seen: string[] = [];
    const first = executeWithPermissionAdmission({ state, authorize: async () => allow, beforeExecute: async () => {}, assertLive: () => {},
      withResource: operation => arbiter.runExclusive('project-a', undefined, operation),
      execute: async (_decision, snapshot) => { started.resolve(); await running.promise; return snapshot.mode; } });
    await started.promise;
    const queued = deferred(); const reauthorized = deferred(); const approve = deferred();
    const second = executeWithPermissionAdmission({ state, authorize: async snapshot => {
      seen.push(snapshot.mode); if (snapshot.revision > 1) { reauthorized.resolve(); await approve.promise; } return allow;
    }, beforeExecute: async () => { queued.resolve(); }, assertLive: () => {},
    withResource: operation => arbiter.runExclusive('project-b', undefined, operation), execute: async (_decision, snapshot) => snapshot.mode });
    await queued.promise; state.commitMode('default'); running.resolve();
    expect(await first).toBe('full-access'); await reauthorized.promise;
    // If the second call kept either claim while awaiting approval, this blocks.
    await arbiter.runExclusive('project-b', undefined, async () => { seen.push('lock-free'); });
    approve.resolve(); expect(await second).toBe('default');
    expect(seen).toEqual(['full-access', 'default', 'lock-free']);
  });

  it('invalidates pending manual approvals, refuses the old answer and keeps an already-settled deny terminal', async () => {
    const state = new RuntimePermissionStateService(); state.initialize('default');
    const approvals = new AgentToolApprovalRequestService(); const events: AgentEvent[] = []; const requested = deferred();
    const effect = vi.fn(async () => 'executed');
    const result = executeWithPermissionAdmission({ state, assertLive: () => {}, beforeExecute: async () => {}, withResource: operation => operation(), execute: effect,
      authorize: async (snapshot, signal) => {
        if (snapshot.mode === 'full-access') return allow;
        const approved = await approvals.request({ agentId: 'general', sessionId: 'owner', turnId: 'turn', toolCallId: 'call', toolName: 'shell', reason: 'test', risk: 'medium', context: { sessionId: 'owner', turnId: 'turn' }, signal,
          onEvent: event => { events.push(event); if (event.type === 'approval.requested') requested.resolve(); } });
        if (!approved) throw new Error('USER_DENIED'); return allow;
      } });
    await requested.promise;
    const approvalId = (events[0].payload as { approvalId: string }).approvalId;
    state.commitMode('full-access');
    expect(approvals.answer({ sessionId: 'owner', turnId: 'turn', approvalId, approved: true }).success).toBe(false);
    expect(await result).toBe('executed'); expect(effect).toHaveBeenCalledOnce();
    expect(events.some(event => (event.payload as { errorCode?: string }).errorCode === 'PERMISSION_MODE_CHANGED')).toBe(true);

    state.commitMode('default'); const deniedRequested = deferred();
    const denied = executeWithPermissionAdmission({ state, assertLive: () => {}, beforeExecute: async () => {}, withResource: operation => operation(), execute: effect,
      authorize: async (_snapshot, signal) => {
        const approved = await approvals.request({ agentId: 'general', sessionId: 'owner', turnId: 'deny-turn', toolCallId: 'deny-call', toolName: 'shell', reason: 'test', risk: 'medium', context: { sessionId: 'owner', turnId: 'deny-turn' }, signal,
          onEvent: event => { events.push(event); if (event.type === 'approval.requested') deniedRequested.resolve(); } });
        if (!approved) throw new Error('USER_DENIED'); return allow;
      } });
    await deniedRequested.promise;
    const pending = events.at(-1)!.payload as { approvalId: string };
    approvals.answer({ sessionId: 'owner', turnId: 'deny-turn', approvalId: pending.approvalId, approved: false });
    state.commitMode('full-access');
    await expect(denied).rejects.toThrow('USER_DENIED'); expect(effect).toHaveBeenCalledOnce();
  });

  it('cancels an ignored-signal reviewer, drops its late approval and can continue in the new mode', async () => {
    const state = new RuntimePermissionStateService(); state.initialize('auto-review');
    const approvals = new AgentToolApprovalRequestService(); const reviewerStarted = deferred(); const review = deferred<{ approved: boolean; reason: string }>();
    const events: AgentEvent[] = []; const effect = vi.fn(async () => 'ok');
    const execution = executeWithPermissionAdmission({ state, assertLive: () => {}, beforeExecute: async () => {}, withResource: operation => operation(), execute: effect,
      authorize: async (snapshot, signal) => {
        if (snapshot.mode !== 'auto-review') return allow;
        const verdict = await approvals.autoReview({ agentId: 'general', sessionId: 'child', turnId: 'turn', toolCallId: 'call', toolName: 'shell', reason: 'test', risk: 'medium', context: { sessionId: 'child', turnId: 'turn' }, signal, onEvent: event => events.push(event),
          action: { tool: 'shell', arguments: {}, reason: 'test', facts: {} }, reviewer: async () => { reviewerStarted.resolve(); return review.promise; } });
        if (!verdict.approved) throw new Error('REVIEW_DENIED'); return allow;
      } });
    await reviewerStarted.promise; state.commitMode('full-access');
    expect(await execution).toBe('ok'); review.resolve({ approved: true, reason: 'late' });
    await Promise.resolve(); expect(effect).toHaveBeenCalledOnce();
    expect(events.filter(event => event.type === 'approval.answered')).toHaveLength(1);
    expect(events.at(-1)?.payload).toMatchObject({ status: 'cancelled', errorCode: 'PERMISSION_MODE_CHANGED' });
  });

  it('shares live state across independently admitted siblings and child scopes and aborts queued work without retry', async () => {
    const state = new RuntimePermissionStateService(); state.initialize('full-access');
    const arbiter = new ToolResourceArbiter(); const entered = deferred(); const finish = deferred();
    const call = (key: string, signal?: AbortSignal) => executeWithPermissionAdmission({ state, signal, authorize: async () => allow,
      assertLive: () => {}, beforeExecute: async () => {}, withResource: operation => arbiter.runShared(key, signal, operation),
      execute: async (_decision, snapshot) => { if (key === 'parent') { entered.resolve(); await finish.promise; } return snapshot.mode; } });
    const parent = call('parent'); await entered.promise; state.commitMode('custom');
    expect(await Promise.all([call('child-foreground'), call('child-background')])).toEqual(['custom', 'custom']);
    finish.resolve(); expect(await parent).toBe('full-access');
    const hold = deferred(); const locked = deferred(); const blocker = arbiter.runExclusive('queued', undefined, async () => { locked.resolve(); await hold.promise; });
    await locked.promise;
    const controller = new AbortController(); const waiting = call('queued', controller.signal);
    controller.abort(); await expect(waiting).rejects.toThrow(); hold.resolve(); await blocker;
  });
});
