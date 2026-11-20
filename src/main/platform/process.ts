/**
 * Process identity, liveness and termination.
 *
 * A process is identified by (pid, birth): the birth token is the OS
 * creation time, so a reused PID never matches a recorded identity. Every
 * liveness and kill decision goes through probeProcess. An identity that
 * cannot be read is `unknown`, which is never treated as proof of exit and
 * never authorizes a kill. An empty birth means none was recorded; such an
 * identity is judged by pid alone, so a live pid keeps it alive.
 */
import { currentHost } from './host';
import { createPosixProcessBackend } from './processPosix';
import { createWin32ProcessBackend } from './processWin32';
import type { ProcessBackend } from './processBackend';

export interface ProcessIdentity {
  readonly pid: number;
  readonly birth: string;
}

export type ProcessLiveness = 'alive' | 'exited' | 'unknown';
/** `terminated`: kill delivered; `exited`: already gone; `unconfirmed`: not killed. */
export type ProcessTermination = 'terminated' | 'exited' | 'unconfirmed';

const DEFAULT_KILL_TIMEOUT_MS = 3_000;

const backend: ProcessBackend = currentHost().isWindows ? createWin32ProcessBackend() : createPosixProcessBackend();

export function createProcessContract(primitives: ProcessBackend) {
  let self: ProcessIdentity | undefined;
  const currentProcessIdentity = (): ProcessIdentity => {
    if (!self) {
      let birth = '';
      try {
        birth = primitives.readBirth(process.pid) ?? '';
      } catch {
        // Unreadable: other processes then judge this identity by pid alone (fail-closed).
      }
      self = Object.freeze({ pid: process.pid, birth });
    }
    return self;
  };
  const probe = (identity: ProcessIdentity): ProcessLiveness => {
    if (!Number.isSafeInteger(identity.pid) || identity.pid <= 0) return 'exited';
    if (identity.pid === process.pid) {
      // This process is alive; a recorded birth only tells whether the record is ours.
      const own = currentProcessIdentity().birth;
      if (!identity.birth || identity.birth === own) return 'alive';
      return own ? 'exited' : 'unknown';
    }
    try {
      if (!identity.birth) return primitives.isRunning(identity.pid) ? 'alive' : 'exited';
      const birth = primitives.readBirth(identity.pid);
      return birth === null || birth !== identity.birth ? 'exited' : 'alive';
    } catch {
      return 'unknown';
    }
  };
  return {
    probeProcess: probe,
    /** This process; the birth is empty when the host cannot report it. */
    currentProcessIdentity,
    readProcessCommandLine(pid: number): string | null {
      return primitives.readCommandLine(pid);
    },
    /** Re-probes the identity right before killing; only a live identity is killed. */
    terminateProcessTree(identity: ProcessIdentity, timeoutMs = DEFAULT_KILL_TIMEOUT_MS): ProcessTermination {
      const before = probe(identity);
      if (before !== 'alive') return before === 'exited' ? 'exited' : 'unconfirmed';
      if (primitives.killTree(identity.pid, timeoutMs)) return 'terminated';
      return probe(identity) === 'exited' ? 'exited' : 'unconfirmed';
    },
    /** Signals an owned child and its descendants (Windows always forces the tree). */
    signalChildProcessTree(pid: number, signal: NodeJS.Signals, timeoutMs: number): void {
      primitives.signalChildTree(pid, signal, timeoutMs);
    },
    isolatedChildSpawnOptions(): { detached?: boolean } {
      return { ...primitives.childGroupOptions };
    },
  };
}

export const {
  probeProcess,
  currentProcessIdentity,
  readProcessCommandLine,
  terminateProcessTree,
  signalChildProcessTree,
  isolatedChildSpawnOptions,
} = createProcessContract(backend);
