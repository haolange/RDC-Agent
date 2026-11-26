import os from 'os';
import { StringDecoder } from 'string_decoder';
import { nowMs } from '@shared/utils/id';
import { requiresCommandInterpreter } from '../platform/shell';
import { processSupervisor, type SupervisedProcess } from '../runtime/ProcessSupervisor';
import type { ChildProcess } from 'child_process';

export interface ShellInvocationRequest {
  command: string;
  args?: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  /** The process wall, or `null` for none: the caller then bounds the process itself (and aborts it). */
  timeoutMs: number | null;
  outputBufferBytes?: number;
  runId?: string;
  contextId?: string;
  abortSignal?: AbortSignal;
  /** Every complete stderr line as it arrives (UTF-8, without the line break); stderr is still buffered as well. */
  onStderrLine?: (line: string) => void;
}

/** A line longer than this is delivered as it stands, so a stream without line breaks cannot grow without bound. */
const MAX_STDERR_LINE_CHARS = 1024 * 1024;

function streamLines(stream: ChildProcess['stderr'] | undefined, onLine: (line: string) => void): void {
  if (!stream) return;
  const decoder = new StringDecoder('utf8');
  let pending = '';
  const push = (text: string) => {
    pending += text;
    let index = pending.indexOf('\n');
    while (index >= 0) {
      onLine(pending.slice(0, index).replace(/\r$/u, ''));
      pending = pending.slice(index + 1);
      index = pending.indexOf('\n');
    }
    if (pending.length > MAX_STDERR_LINE_CHARS) {
      onLine(pending);
      pending = '';
    }
  };
  stream.on('data', (chunk: Buffer | string) => push(typeof chunk === 'string' ? chunk : decoder.write(chunk)));
  stream.on('end', () => {
    push(decoder.end());
    if (pending) onLine(pending);
    pending = '';
  });
}

export function resolveExitCode(code: number | null, signal: NodeJS.Signals | null): number {
  if (code !== null) {
    return code;
  }
  if (signal) {
    const signalNumber = os.constants.signals[signal];
    return 128 + (typeof signalNumber === 'number' ? signalNumber : 0);
  }
  return 1;
}

export class ShellInvocationService {
  private activeProcesses = new Map<string, { supervised: SupervisedProcess; runId?: string; contextId?: string }>();

  async invoke(request: ShellInvocationRequest): Promise<CLIResult> {
    const startTime = nowMs();
    const command = request.command.trim();
    if (!command) {
      return {
        exitCode: 2,
        stdout: '',
        stderr: 'RDC-Tool CLI command is not configured.',
        duration_ms: nowMs() - startTime,
      };
    }

    const needsShell = requiresCommandInterpreter(command);
    const supervised = processSupervisor.spawn('shell', command, request.args ?? [], {
      cwd: request.cwd || undefined,
      env: {
        ...process.env,
        ...request.env,
        PYTHONIOENCODING: 'utf-8',
      },
      shell: needsShell,
      windowsHide: true,
      timeoutMs: request.timeoutMs ?? undefined,
      ringBufferBytes: request.outputBufferBytes,
      abortSignal: request.abortSignal,
    });
    // A spawn that threw synchronously has no child; its join reports spawn_failed below.
    if (request.onStderrLine) streamLines((supervised.child as ChildProcess | null)?.stderr, request.onStderrLine);

    const procId = supervised.id;
    this.activeProcesses.set(procId, { supervised, runId: request.runId, contextId: request.contextId });

    try {
      // The wall (if any) and every abort end in close or in the supervisor's bounded orphan observation.
      const info = await supervised.join();
      const stdout = supervised.stdout.toString();
      const stderr = supervised.stderr.toString();
      const outputMetadata = {
        stdoutByteLength: supervised.stdout.receivedByteLength(),
        stdoutTruncated: supervised.stdout.wasTruncated(),
      };

      if (info.reason === 'spawn_failed') {
        return {
          exitCode: 2,
          stdout,
          ...outputMetadata,
          stderr: info.error?.message || stderr || 'spawn failed',
          duration_ms: nowMs() - startTime,
        };
      }
      if (info.reason === 'timeout') {
        return {
          exitCode: 124,
          stdout,
          ...outputMetadata,
          stderr: stderr || `Process timeout after ${request.timeoutMs}ms`,
          duration_ms: nowMs() - startTime,
        };
      }
      if (info.reason === 'unconfirmed_orphan') {
        return {
          exitCode: 1,
          processExitReason: 'unconfirmed_orphan',
          stdout,
          ...outputMetadata,
          stderr: stderr || 'Process termination was not confirmed; the process is quarantined as an orphan.',
          duration_ms: nowMs() - startTime,
        };
      }
      return {
        exitCode: resolveExitCode(info.code, info.signal),
        stdout,
        ...outputMetadata,
        stderr,
        duration_ms: nowMs() - startTime,
      };
    } finally {
      if (supervised.orphaned) {
        void supervised.exit.then(() => {
          this.activeProcesses.delete(procId);
        });
      } else {
        this.activeProcesses.delete(procId);
      }
    }
  }

  hasUnconfirmedProcesses(contextId?: string): boolean {
    return Array.from(this.activeProcesses.values()).some(
      ({ supervised, contextId: owner }) => supervised.orphaned && (!contextId || owner === contextId),
    );
  }

  abortRun(runId: string): void {
    for (const { supervised, runId: activeRunId } of this.activeProcesses.values()) {
      if (activeRunId !== runId) continue;
      supervised.abort('abort');
    }
  }

  terminateAll(): void {
    for (const active of this.activeProcesses.values()) {
      active.supervised.abort('supervisor_kill');
    }
    // Entries remain tracked until invoke observes close; abort is not exit evidence.
  }
}

export const shellInvocationService = new ShellInvocationService();

export interface CLIResult {
  processExitReason?:
    'exit' | 'signal' | 'timeout' | 'abort' | 'spawn_failed' | 'supervisor_kill' | 'unconfirmed_orphan';
  exitCode: number;
  stdout: string;
  stdoutByteLength?: number;
  stdoutTruncated?: boolean;
  stderr: string;
  duration_ms: number;
}
