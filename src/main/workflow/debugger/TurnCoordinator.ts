/**
 * TurnCoordinator — per-session turn handles; eliminates turn-global mutable state.
 *
 * Also serves as the TurnEventSinkRegistry (Phase 4)：eventSink 挂在 TurnHandle 上，
 * 禁止再维护 Orchestrator 侧 activeTurnBySession 双轨。
 *
 * Each active turn owns: eventSink, deferred activation, pending approvals/handoff,
 * task registry hook, agent slot key, cancellation scope, generation token, producers.
 */

import type { AgentEvent as SharedAgentEvent } from '@shared/types/agentRuntime';
import type { AgentRole } from '@shared/types/agent';
import type { ToolDefinition } from '../../agent-runtime/core/types';
import type { CompiledPolicy } from '@shared/types/rdxRuntime';
import type { EffectiveRuntimePlan } from '../../agent-runtime/EffectiveRuntimePlan';

export type AbortReason =
  | 'user_stop'
  | 'branch_switch'
  | 'edit_resend'
  | 'app_shutdown'
  | 'timeout'
  | 'policy_revoke'
  | 'parent_abort'
  | 'unknown';

export interface TurnEventSink {
  onEvent?: (event: SharedAgentEvent) => void;
  sessionId?: string | null;
  projectRootPath?: string | null;
  projectId?: string | null;
  agentId?: AgentRole;
}

export interface TurnDeferredActivation {
  slotKey: string;
  allDefinitions: ToolDefinition[];
}

export interface PendingHandoff {
  turnId: string;
  fromAgentId: AgentRole;
  toProfile: AgentRole;
  prompt: string;
  label: string;
  sessionId?: string | null;
}

export interface PolicyBudgetState {
  toolCalls: number;
  subagents: number;
  childDepth: number;
  wallStartedAt: number;
  maxToolCalls: number;
  maxSubagents: number;
  maxChildDepth: number;
  maxWallTimeMs: number;
}

export function assertPolicyWallTimeAllowed(maxWallTimeMs: number): void {
  if (maxWallTimeMs === 0) {
    throw new Error('POLICY_MAX_WALL_TIME_ZERO: maxWallTimeMs must be greater than zero for an executable turn.');
  }
}

export function createPolicyBudgetState(
  policy?: Pick<CompiledPolicy, 'maxToolCalls' | 'maxSubagents' | 'maxChildDepth' | 'maxWallTimeMs'>,
  childDepth = 0,
  shared?: PolicyBudgetState,
): PolicyBudgetState {
  if (shared) {
    assertPolicyWallTimeAllowed(shared.maxWallTimeMs);
    return shared;
  }
  const maxWallTimeMs = policy?.maxWallTimeMs ?? Number.MAX_SAFE_INTEGER;
  assertPolicyWallTimeAllowed(maxWallTimeMs);
  return {
    toolCalls: 0,
    subagents: 0,
    childDepth,
    wallStartedAt: Date.now(),
    maxToolCalls: policy?.maxToolCalls ?? Number.MAX_SAFE_INTEGER,
    maxSubagents: policy?.maxSubagents ?? Number.MAX_SAFE_INTEGER,
    maxChildDepth: policy?.maxChildDepth ?? Number.MAX_SAFE_INTEGER,
    maxWallTimeMs,
  };
}

export interface SubagentBudget {
  maxDepth: number;
  maxChildren: number;
  maxAggregateToolCalls: number;
  maxAggregateWallMs: number;
}

export const DEFAULT_SUBAGENT_BUDGET: SubagentBudget = {
  maxDepth: 3,
  maxChildren: 5,
  maxAggregateToolCalls: 40,
  maxAggregateWallMs: 300_000,
};

export type SubagentResultStatus = 'complete' | 'cancelled' | 'failed';

export interface SubagentBudgetState {
  depth: number;
  childrenSpawned: number;
  aggregateToolCalls: number;
  wallStartedAt: number;
  budget: SubagentBudget;
}

export function createSubagentBudgetState(
  budget: SubagentBudget = DEFAULT_SUBAGENT_BUDGET,
  depth = 0,
): SubagentBudgetState {
  return {
    depth,
    childrenSpawned: 0,
    aggregateToolCalls: 0,
    wallStartedAt: Date.now(),
    budget,
  };
}

export function assertSubagentBudgetAllowsChild(state: SubagentBudgetState): void {
  if (state.depth >= state.budget.maxDepth) {
    throw new Error(`SUBAGENT_BUDGET: maxDepth ${state.budget.maxDepth} exceeded.`);
  }
  if (state.childrenSpawned >= state.budget.maxChildren) {
    throw new Error(`SUBAGENT_BUDGET: maxChildren ${state.budget.maxChildren} exceeded.`);
  }
  if (state.aggregateToolCalls >= state.budget.maxAggregateToolCalls) {
    throw new Error(
      `SUBAGENT_BUDGET: maxAggregateToolCalls ${state.budget.maxAggregateToolCalls} exceeded.`,
    );
  }
  const elapsed = Date.now() - state.wallStartedAt;
  if (elapsed >= state.budget.maxAggregateWallMs) {
    throw new Error(
      `SUBAGENT_BUDGET: maxAggregateWallMs ${state.budget.maxAggregateWallMs} exceeded.`,
    );
  }
}

export type TurnProducer = {
  id: string;
  abort: (reason: AbortReason) => void;
  join: () => Promise<void>;
};

export interface AbortAndJoinOptions {
  graceMs?: number;
  forceAfterMs?: number;
  reason?: AbortReason;
}

export class TurnHandle {
  readonly sessionKey: string;
  readonly turnId: string;
  /** The owning workflow run. Tool-side outputs must never escape this run. */
  readonly runId: string | null;
  readonly generation: number;
  readonly startedAt: number;
  readonly abortController: AbortController;
  readonly subagentBudget: SubagentBudgetState;
  readonly policyBudget: PolicyBudgetState;
  /** Frozen runtime authority installed before any tool can execute. */
  runtimePlan: EffectiveRuntimePlan | null = null;

  eventSink: TurnEventSink | null = null;
  deferredActivation: TurnDeferredActivation | null = null;
  pendingHandoff: PendingHandoff | null = null;
  agentSlotKey: string | null = null;

  private readonly producers = new Map<string, TurnProducer>();
  private aborted = false;
  private abortReason: AbortReason | null = null;
  private joinPromise: Promise<void> | null = null;
  private closed = false;
  private orphaned = false;
  private wallTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(input: {
    sessionKey: string;
    turnId: string;
    runId?: string | null;
    generation: number;
    parentSignal?: AbortSignal | null;
    subagentBudget?: SubagentBudgetState;
    policyBudget?: PolicyBudgetState;
  }) {
    this.sessionKey = input.sessionKey;
    this.turnId = input.turnId;
    this.runId = input.runId ?? null;
    this.generation = input.generation;
    this.startedAt = Date.now();
    this.abortController = new AbortController();
    this.subagentBudget = input.subagentBudget ?? createSubagentBudgetState();
    this.policyBudget = input.policyBudget ?? createPolicyBudgetState();
    assertPolicyWallTimeAllowed(this.policyBudget.maxWallTimeMs);
    if (this.policyBudget.maxWallTimeMs > 0 && this.policyBudget.maxWallTimeMs < 2_147_000_000) {
      this.wallTimer = setTimeout(() => {
        void this.abortAndJoin({ reason: 'timeout' });
      }, this.policyBudget.maxWallTimeMs);
      this.wallTimer.unref?.();
    }

    if (input.parentSignal) {
      if (input.parentSignal.aborted) {
        this.abortController.abort();
        this.aborted = true;
        this.abortReason = 'parent_abort';
      } else {
        input.parentSignal.addEventListener(
          'abort',
          () => {
            void this.abortAndJoin({ reason: 'parent_abort' });
          },
          { once: true },
        );
      }
    }
  }

  get signal(): AbortSignal {
    return this.abortController.signal;
  }

  get isAborted(): boolean {
    return this.aborted || this.abortController.signal.aborted;
  }

  get reason(): AbortReason | null {
    return this.abortReason;
  }

  /** True when a bounded abort could not confirm all producers stopped. */
  get isOrphaned(): boolean {
    return this.orphaned;
  }

  /** True when this handle is still the active generation for late-write guards. */
  isLive(expectedGeneration: number): boolean {
    return !this.closed && this.generation === expectedGeneration && !this.aborted;
  }

  /**
   * Emit an event only if the turn is still live (generation token guard).
   * Returns false when the write was dropped as late.
   */
  emitEvent(event: SharedAgentEvent, expectedGeneration?: number): boolean {
    if (this.closed) return false;
    if (expectedGeneration != null && expectedGeneration !== this.generation) return false;
    if (this.aborted) return false;
    this.eventSink?.onEvent?.(event);
    return true;
  }

  registerProducer(producer: TurnProducer): () => void {
    this.producers.set(producer.id, producer);
    return () => {
      this.producers.delete(producer.id);
    };
  }

  async abortAndJoin(options: AbortAndJoinOptions = {}): Promise<void> {
    const reason = options.reason ?? 'unknown';
    if (!this.aborted) {
      this.aborted = true;
      this.abortReason = reason;
      try {
        this.abortController.abort();
      } catch {
        // ignore
      }
      for (const producer of this.producers.values()) {
        try {
          producer.abort(reason);
        } catch {
          // ignore individual producer abort failures
        }
      }
    }

    if (this.joinPromise) return this.joinPromise;

    const graceMs = options.graceMs ?? 1_500;
    const forceAfterMs = options.forceAfterMs ?? 5_000;

    this.joinPromise = (async () => {
      const joins = Array.from(this.producers.values()).map((p) => p.join());
      const allJoined = Promise.allSettled(joins);
      const waitFor = async (durationMs: number): Promise<boolean> => {
        let timer: ReturnType<typeof setTimeout> | null = null;
        const result = await Promise.race([
          allJoined.then(() => true),
          new Promise<boolean>((resolve) => {
            timer = setTimeout(() => resolve(false), Math.max(0, durationMs));
            timer.unref?.();
          }),
        ]);
        if (timer) clearTimeout(timer);
        return result;
      };
      if (await waitFor(graceMs)) {
        this.closed = true;
        this.producers.clear();
        if (this.wallTimer) { clearTimeout(this.wallTimer); this.wallTimer = null; }
        return;
      }

      // Escalate once the graceful window is exhausted. Producers remain
      // registered until their own join promises settle.
      for (const producer of this.producers.values()) {
        try {
          producer.abort(reason);
        } catch {
          // ignore individual producer abort failures
        }
      }
      if (await waitFor(forceAfterMs)) {
        this.closed = true;
        this.producers.clear();
        if (this.wallTimer) { clearTimeout(this.wallTimer); this.wallTimer = null; }
        return;
      }

      // Do not announce a clean close or discard producers until their promises settle.
      this.orphaned = true;
      void allJoined.then(() => {
        if (!this.closed) {
          this.closed = true;
          this.producers.clear();
          if (this.wallTimer) { clearTimeout(this.wallTimer); this.wallTimer = null; }
        }
      });
    })();

    return this.joinPromise;
  }

  close(): void {
    this.closed = true;
    if (this.wallTimer) { clearTimeout(this.wallTimer); this.wallTimer = null; }
    this.eventSink = null;
    this.deferredActivation = null;
  }
}

export class TurnCoordinator {
  private readonly activeBySession = new Map<string, TurnHandle>();
  private generationSeq = 0;

  getActive(sessionKey: string): TurnHandle | null {
    return this.activeBySession.get(sessionKey) ?? null;
  }

  /** Begin a turn for a session; aborts any previous active turn for that session. */
  async beginTurn(input: {
    sessionKey: string;
    turnId: string;
    runId?: string | null;
    parentSignal?: AbortSignal | null;
    eventSink?: TurnEventSink | null;
    subagentBudget?: SubagentBudgetState;
    policyBudget?: PolicyBudgetState;
  }): Promise<TurnHandle> {
    const previous = this.activeBySession.get(input.sessionKey);
    if (previous) {
      await previous.abortAndJoin({ reason: 'edit_resend', graceMs: 500, forceAfterMs: 2_000 });
    }
    this.generationSeq += 1;
    const handle = new TurnHandle({
      sessionKey: input.sessionKey,
      turnId: input.turnId,
      runId: input.runId,
      generation: this.generationSeq,
      parentSignal: input.parentSignal,
      subagentBudget: input.subagentBudget,
      policyBudget: input.policyBudget,
    });
    if (input.eventSink) {
      handle.eventSink = input.eventSink;
    }
    this.activeBySession.set(input.sessionKey, handle);
    return handle;
  }

  /** End turn if it is still the active generation. */
  endTurn(handle: TurnHandle): void {
    const current = this.activeBySession.get(handle.sessionKey);
    if (current === handle) {
      this.activeBySession.delete(handle.sessionKey);
    }
    handle.close();
  }

  async abortSession(sessionKey: string, reason: AbortReason = 'user_stop'): Promise<void> {
    const handle = this.activeBySession.get(sessionKey);
    if (!handle) return;
    await handle.abortAndJoin({ reason });
    this.activeBySession.delete(sessionKey);
  }

  async abortAll(reason: AbortReason = 'app_shutdown'): Promise<void> {
    const handles = Array.from(this.activeBySession.values());
    this.activeBySession.clear();
    await Promise.allSettled(handles.map((h) => h.abortAndJoin({ reason })));
  }
}

export const turnCoordinator = new TurnCoordinator();
