import { isRdcProcessFailure, RdcNativeFailure } from './RdcNativeProtocol';
import type { RdcOperationDefinition } from './RdcOperationCatalog';
import type { RdcCancellation } from './RdcOperationWatcher';

/**
 * Where a native call was when it failed:
 * - `preflight`: the replay read that precedes the operation;
 * - `native`: the operation itself, up to a parsed canonical result;
 * - `verifying`: main's checks of that result's identity and of a temporary position's restoration;
 * - `settled`: the replay state is proven by the result; what fails now is main's own handling of it.
 */
export type RdcCallPhase = 'preflight' | 'native' | 'verifying' | 'settled';

/** The effects a pure read may have: it can write an artifact, and never moves or changes the replay. */
const PURE_READ_EFFECTS: ReadonlySet<string> = new Set(['artifact_write']);

/** By its frozen catalog contract the operation cannot change the replay, whatever its outcome. */
export function isPureRdcRead(definition: Pick<RdcOperationDefinition, 'effects'>): boolean {
  return definition.effects.every((effect) => PURE_READ_EFFECTS.has(effect));
}

/** Native codes that say the replay's runtime itself is unavailable; only a rebuild answers them. */
const INFRASTRUCTURE_CODES: ReadonlySet<string> = new Set(['daemon_owner_unavailable']);

/** The daemon processed this very operation and answered with a canonical error that is not about its own runtime. */
function answeredCanonically(error: unknown, resultKind: string): boolean {
  return (
    error instanceof RdcNativeFailure &&
    error.resultKind === resultKind &&
    !isRdcProcessFailure(error) &&
    !INFRASTRUCTURE_CODES.has(error.nativeError.code)
  );
}

/**
 * Whether a failed native call leaves the owning replay uncertain, so its lease is quarantined (and then recovered).
 * The replay is uncertain only when the call could have changed it and no result proves what it became, or when its
 * runtime stopped answering. A pure read the daemon answered, a failure before the operation ran, a pure read
 * cancelled with RDC-Tool's settled receipt, and main's own handling of a proven result all leave it as it was; a
 * shader replacement whose receipt main could not sign stays uncertain, because nothing can roll it back.
 */
export function rdcFailureQuarantines(input: {
  phase: RdcCallPhase;
  definition: Pick<RdcOperationDefinition, 'name' | 'effects'>;
  error: unknown;
  aborted: boolean;
  cancellation: RdcCancellation | undefined;
}): boolean {
  const { phase, definition, error } = input;
  const pureRead = isPureRdcRead(definition);
  if (input.aborted && phase !== 'settled') {
    // RDC-Tool settled the cancelled call and its worker kept running: a read that ran is all that happened.
    const { cancellation } = input;
    const settled =
      cancellation?.status === 'settled' && cancellation.outcome !== 'terminated' && !cancellation.workerExit;
    return !(settled && (phase === 'preflight' || pureRead));
  }
  switch (phase) {
    case 'settled':
      // A replacement main did not finish registering cannot be rolled back through it.
      return definition.effects.includes('shader_replacement');
    case 'preflight':
      return !answeredCanonically(error, 'rd.session.get_context');
    case 'native':
      return !(pureRead && answeredCanonically(error, definition.name));
    case 'verifying':
      return true;
  }
}
