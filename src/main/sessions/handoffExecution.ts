import { HandoffContractSchema } from '@shared/types/handoffContract';
import { HANDOFF_EXECUTION_CYCLE_LIMIT, type ProfileHandoffState } from '@shared/types/profileHandoff';
import type { PrepareHandoffInput } from './HandoffStateStore';

export function assertHandoffTransition(input: PrepareHandoffInput, history: readonly ProfileHandoffState[]): void {
  const contract = HandoffContractSchema.parse(input.contract);
  const chain = history.filter(entry => entry.chainRoot === input.chainRoot && entry.lifecycle === 'consumed');
  const previous = chain.at(-1);
  const reject = (detail: string): never => { throw new Error('HANDOFF_STATE_CONFLICT: ' + detail); };
  if (!input.prompt.trim()) reject('handoff summary is required.');
  if (contract.intent === 'route') {
    if (chain.length) reject('initial routing is allowed only once per root.');
    return;
  }
  if (contract.intent === 'execute') {
    if (contract.returnTo !== input.sourceAgentId) reject('returnTo must be the actual dispatcher.');
    if (input.toAgentId === input.sourceAgentId) reject('cannot dispatch execution to self.');
    if (previous && previous.toAgentId !== input.sourceAgentId) reject('dispatcher does not own this chain.');
    if (previous?.contract.intent === 'execute') reject('execution must return before another cycle.');
    const cycles = new Set(chain.filter(entry => entry.contract.intent === 'execute').map(entry => entry.handoffId)).size;
    if (cycles >= HANDOFF_EXECUTION_CYCLE_LIMIT) {
      throw new Error('HANDOFF_CYCLE_LIMIT: two execution cycles used; save a checkpoint and await a new user instruction.');
    }
    return;
  }
  if (!previous || previous.contract.intent !== 'execute'
    || previous.handoffId !== contract.executionHandoffId
    || previous.toAgentId !== input.sourceAgentId
    || previous.sourceAgentId !== input.toAgentId
    || previous.continuationTurnId !== input.sourceTurnId) {
    reject('return must match the current execution binding and its actual dispatcher.');
  }
}
