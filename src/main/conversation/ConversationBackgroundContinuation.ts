import type { AgentRole } from '@shared/types/agent';
import type { PolicyBudgetState } from '../workflow/debugger/TurnCoordinator';

export interface BackgroundContinuationEvent { sessionId: string; executionId: string; parentAgentId: AgentRole; policyBudget?: PolicyBudgetState }

export class ConversationBackgroundContinuation {
  private readonly pending = new Map<string, { event: BackgroundContinuationEvent; sequence: number }>();
  private readonly inFlight = new Set<string>();
  private readonly attempted = new Map<string, number>();
  private readonly suppressed = new Set<string>();
  private sequence = 0;

  constructor(private readonly run: (event: BackgroundContinuationEvent) => Promise<void>) {}

  resume(sessionId: string): void { this.suppressed.delete(sessionId); }
  suppress(sessionId: string): void { this.suppressed.add(sessionId); this.pending.delete(sessionId); this.attempted.delete(sessionId); }
  onSettled(event: BackgroundContinuationEvent): void {
    if (!this.suppressed.has(event.sessionId)) this.pending.set(event.sessionId, { event, sequence: ++this.sequence });
  }
  notifyIdle(sessionId: string): void {
    const pending = this.pending.get(sessionId);
    if (!pending || this.inFlight.has(sessionId) || this.suppressed.has(sessionId) || this.attempted.get(sessionId) === pending.sequence) return;
    this.inFlight.add(sessionId);
    this.attempted.set(sessionId, pending.sequence);
    void this.run(pending.event).then(() => {
      if (this.pending.get(sessionId)?.sequence === pending.sequence) this.pending.delete(sessionId);
    }).catch(() => {
      // Keep the durable event pending; the next idle boundary can retry it.
    }).finally(() => {
      this.inFlight.delete(sessionId);
      const next = this.pending.get(sessionId);
      if (next && next.sequence > pending.sequence && !this.suppressed.has(sessionId)) this.notifyIdle(sessionId);
    });
  }
}
