import { AgentLoopTerminationError } from './LoopProgressGuard';
import type { StopReason } from '../core/types';

/** Stop a repeated terminal response that cannot change the same obligation. */
export class RuntimeContinuationGuard {
  private previous?: string;

  async next(input: {
    reason: StopReason;
    isDone: boolean;
    remaining: number;
    turn: number;
    maxTurns: number;
    check?: () => Promise<string | undefined>;
  }): Promise<string | undefined> {
    const continuation = input.reason === 'stop' && !input.isDone ? await input.check?.() : undefined;
    if (!continuation) return undefined;
    if (input.remaining === 1)
      throw new AgentLoopTerminationError(
        'AGENT_MAX_TURNS_EXCEEDED',
        'Explicit turn limit reached with an incomplete runtime obligation.',
        { turn: input.turn, maxTurns: input.maxTurns },
      );
    if (continuation === this.previous)
      throw new AgentLoopTerminationError(
        'AGENT_NO_PROGRESS',
        'The runtime obligation remained unchanged after a continuation without tool work.',
        { turn: input.turn, noProgressReason: 'runtime-obligation' },
      );
    this.previous = continuation;
    return continuation;
  }

  reset(): void {
    this.previous = undefined;
  }
}
