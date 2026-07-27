/**
 * ProcessSupervisor — unified child-process registry with tree kill + ring buffers.
 *
 * POSIX: spawn with detached process group; SIGTERM → grace → SIGKILL (-pid).
 * Windows: process-tree termination via taskkill /T (Job Object not available without native addon).
 */

import {
  spawn,
  spawnSync,
  type ChildProcess,
  type SpawnOptions,
  type StdioOptions,
} from 'child_process';
import { generateEventId } from '@shared/utils/id';

export type ProcessExitReason =
  | 'exit'
  | 'signal'
  | 'timeout'
  | 'abort'
  | 'spawn_failed'
  | 'supervisor_kill';

export type ProcessOwner =
  | 'mcp'
  | 'shell'
  | 'terminal'
  | 'hook'
  | 'replay'
  | 'bash'
  | 'background'
  | 'daemon'
  | 'other';

export interface SupervisedSpawnOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  shell?: boolean | string;
  stdio?: StdioOptions;
  windowsHide?: boolean;
  /** When false, skip process-group / tree-kill setup (rare; default true). */
  isolateProcessGroup?: boolean;
  timeoutMs?: number;
  abortSignal?: AbortSignal;
  /** Max bytes retained per stream in the ring buffer (default 256 KiB). */
  ringBufferBytes?: number;
}

export interface SupervisedProcess {
  readonly id: string;
  readonly owner: ProcessOwner;
  readonly pid: number | undefined;
  readonly child: ChildProcess;
  readonly startedAt: number;
  readonly stdout: RingBuffer;
  readonly stderr: RingBuffer;
  readonly exit: Promise<ProcessExitInfo>;
  abort(reason?: ProcessExitReason): void;
  join(timeoutMs?: number): Promise<ProcessExitInfo>;
}

export interface ProcessExitInfo {
  reason: ProcessExitReason;
  code: number | null;
  signal: NodeJS.Signals | null;
  error?: Error;
  durationMs: number;
}

const DEFAULT_RING_BYTES = 256 * 1024;
const DEFAULT_GRACE_MS = 2_000;

export class RingBuffer {
  private chunks: Buffer[] = [];
  private size = 0;

  constructor(private readonly maxBytes: number) {}

  append(chunk: Buffer | string): void {
    const buf = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk;
    if (buf.length === 0) return;
    this.chunks.push(buf);
    this.size += buf.length;
    while (this.size > this.maxBytes && this.chunks.length > 0) {
      const dropped = this.chunks.shift();
      if (dropped) this.size -= dropped.length;
    }
  }

  toString(encoding: BufferEncoding = 'utf8'): string {
    if (this.chunks.length === 0) return '';
    return Buffer.concat(this.chunks, this.size).toString(encoding);
  }

  byteLength(): number {
    return this.size;
  }
}

interface RegistryEntry {
  supervised: SupervisedProcess;
  child: ChildProcess;
  resolveExit: (info: ProcessExitInfo) => void;
  exitInfo: ProcessExitInfo | null;
  forcedReason: ProcessExitReason | null;
  killTimer: ReturnType<typeof setTimeout> | null;
  timeoutTimer: ReturnType<typeof setTimeout> | null;
  abortHandler: (() => void) | null;
  abortSignal: AbortSignal | null;
  startedAt: number;
}

function terminateTree(pid: number | undefined, signal: NodeJS.Signals = 'SIGTERM'): void {
  if (pid == null || pid <= 0) return;
  if (process.platform === 'win32') {
    // taskkill has no graceful process-tree signal; /F is the only bounded abort.
    spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
    });
    return;
  }
  try {
    process.kill(-pid, signal);
  } catch {
    try {
      process.kill(pid, signal);
    } catch {
      // already gone
    }
  }
}

export class ProcessSupervisor {
  private readonly registry = new Map<string, RegistryEntry>();
  private shuttingDown = false;

  get size(): number {
    return this.registry.size;
  }

  list(): ReadonlyArray<{ id: string; owner: ProcessOwner; pid: number | undefined }> {
    return Array.from(this.registry.values()).map((entry) => ({
      id: entry.supervised.id,
      owner: entry.supervised.owner,
      pid: entry.supervised.pid,
    }));
  }

  spawn(
    owner: ProcessOwner,
    command: string,
    args: string[] = [],
    opts: SupervisedSpawnOptions = {},
  ): SupervisedProcess {
    if (this.shuttingDown) {
      throw new Error('ProcessSupervisor is shutting down; refusing new spawn.');
    }

    const id = generateEventId('proc');
    const ringBytes = opts.ringBufferBytes ?? DEFAULT_RING_BYTES;
    const stdout = new RingBuffer(ringBytes);
    const stderr = new RingBuffer(ringBytes);
    const startedAt = Date.now();
    const isolate = opts.isolateProcessGroup !== false;
    const isWin = process.platform === 'win32';

    const spawnOpts: SpawnOptions = {
      cwd: opts.cwd,
      env: opts.env ?? process.env,
      shell: opts.shell,
      stdio: opts.stdio ?? ['ignore', 'pipe', 'pipe'],
      windowsHide: opts.windowsHide ?? true,
    };

    if (isolate && !isWin) {
      // New process group so we can kill(-pid).
      spawnOpts.detached = true;
    }

    let child: ChildProcess;
    try {
      child = spawn(command, args, spawnOpts);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      const failed: SupervisedProcess = {
        id,
        owner,
        pid: undefined,
        child: null as unknown as ChildProcess,
        startedAt,
        stdout,
        stderr,
        exit: Promise.resolve({
          reason: 'spawn_failed' as const,
          code: null,
          signal: null,
          error: err,
          durationMs: 0,
        }),
        abort: () => undefined,
        join: async () => ({
          reason: 'spawn_failed' as const,
          code: null,
          signal: null,
          error: err,
          durationMs: 0,
        }),
      };
      return failed;
    }

    let resolveExit!: (info: ProcessExitInfo) => void;
    const exitPromise = new Promise<ProcessExitInfo>((resolve) => {
      resolveExit = resolve;
    });

    const entry: RegistryEntry = {
      supervised: null as unknown as SupervisedProcess,
      child,
      resolveExit,
      exitInfo: null,
      forcedReason: null,
      killTimer: null,
      timeoutTimer: null,
      abortHandler: null,
      abortSignal: opts.abortSignal ?? null,
      startedAt,
    };

    const settle = (info: ProcessExitInfo): void => {
      if (entry.exitInfo) return;
      entry.exitInfo = info;
      if (entry.killTimer) {
        clearTimeout(entry.killTimer);
        entry.killTimer = null;
      }
      if (entry.timeoutTimer) {
        clearTimeout(entry.timeoutTimer);
        entry.timeoutTimer = null;
      }
      if (entry.abortSignal && entry.abortHandler) {
        entry.abortSignal.removeEventListener('abort', entry.abortHandler);
      }
      this.registry.delete(id);
      resolveExit(info);
    };

    const abort = (reason: ProcessExitReason = 'abort'): void => {
      if (entry.exitInfo) return;
      entry.forcedReason = reason;
      terminateTree(child.pid, 'SIGTERM');
      try {
        if (!child.killed) child.kill();
      } catch {
        // Parent already exited; the tree-kill path above remains authoritative.
      }
      entry.killTimer = setTimeout(() => {
        terminateTree(child.pid, 'SIGKILL');
      }, DEFAULT_GRACE_MS);
      entry.killTimer.unref?.();
    };

    const supervised: SupervisedProcess = {
      id,
      owner,
      get pid() {
        return child.pid;
      },
      child,
      startedAt,
      stdout,
      stderr,
      exit: exitPromise,
      abort,
      join: async (timeoutMs?: number) => {
        if (entry.exitInfo) return entry.exitInfo;
        if (timeoutMs == null || timeoutMs <= 0) return exitPromise;
        return Promise.race([
          exitPromise,
          new Promise<ProcessExitInfo>((resolve) => {
            const timer = setTimeout(() => {
              if (!entry.exitInfo && !entry.forcedReason) abort('timeout');
              const reason = entry.forcedReason ?? 'timeout';
              const info: ProcessExitInfo = {
                reason,
                code: null,
                signal: null,
                durationMs: Date.now() - startedAt,
              };
              settle(info);
              resolve(info);
            }, timeoutMs);
            timer.unref?.();
          }),
        ]);
      },
    };
    entry.supervised = supervised;
    this.registry.set(id, entry);

    child.stdout?.on('data', (chunk: Buffer | string) => stdout.append(chunk));
    child.stderr?.on('data', (chunk: Buffer | string) => stderr.append(chunk));

    child.on('error', (error) => {
      settle({
        reason: entry.forcedReason ?? 'spawn_failed',
        code: null,
        signal: null,
        error,
        durationMs: Date.now() - startedAt,
      });
    });

    child.on('close', (code, signal) => {
      let reason: ProcessExitReason = 'exit';
      if (entry.forcedReason) {
        reason = entry.forcedReason;
      } else if (signal) {
        reason = 'signal';
      }
      settle({
        reason,
        code,
        signal,
        durationMs: Date.now() - startedAt,
      });
    });

    if (opts.timeoutMs && opts.timeoutMs > 0) {
      entry.timeoutTimer = setTimeout(() => {
        abort('timeout');
      }, opts.timeoutMs);
      entry.timeoutTimer.unref?.();
    }

    if (opts.abortSignal) {
      const handler = () => abort('abort');
      entry.abortHandler = handler;
      if (opts.abortSignal.aborted) {
        handler();
      } else {
        opts.abortSignal.addEventListener('abort', handler, { once: true });
      }
    }

    return supervised;
  }

  /** Abort every registered process and wait for exits (bounded). */
  async joinAll(options?: { graceMs?: number; forceAfterMs?: number }): Promise<void> {
    this.shuttingDown = true;
    const graceMs = options?.graceMs ?? DEFAULT_GRACE_MS;
    const forceAfterMs = options?.forceAfterMs ?? graceMs + 3_000;
    const entries = Array.from(this.registry.values());
    for (const entry of entries) {
      entry.supervised.abort('supervisor_kill');
    }
    const joins = entries.map((entry) => entry.supervised.join(forceAfterMs));
    await Promise.race([
      Promise.allSettled(joins),
      new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, forceAfterMs + graceMs);
        timer.unref?.();
      }),
    ]);
    // Bounded shutdown must leave an empty registry even if a platform kill races.
    this.registry.clear();
  }

  /** Soft reset after joinAll so tests / restarts can spawn again. */
  resetForTests(): void {
    this.shuttingDown = false;
    this.registry.clear();
  }
}

export const processSupervisor = new ProcessSupervisor();
