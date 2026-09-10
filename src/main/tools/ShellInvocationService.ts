import os from 'os';
import path from 'path';
import { nowMs } from '@shared/utils/id';
import type { CLIResult } from '@shared/types/tool';
import { processSupervisor, type SupervisedProcess } from '../runtime/ProcessSupervisor';

export interface ShellInvocationRequest {
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
  runId?: string;
  contextId?: string;
  abortSignal?: AbortSignal;
}

export function resolveExitCode(code: number | null, signal: NodeJS.Signals | null): number {
  if (code !== null && code !== undefined) {
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
        stderr: 'RDX CLI command is not configured.',
        duration_ms: nowMs() - startTime,
      };
    }

    const needsShell = process.platform === 'win32' && ['.bat', '.cmd'].includes(path.extname(command).toLowerCase());
    const supervised = processSupervisor.spawn('shell', command, request.args ?? [], {
      cwd: request.cwd || undefined,
      env: {
        ...process.env,
        ...request.env,
        PYTHONIOENCODING: 'utf-8',
      },
      shell: needsShell,
      windowsHide: true,
      timeoutMs: request.timeoutMs,
      abortSignal: request.abortSignal,
      isolateProcessGroup: process.platform !== 'win32',
    });

    const procId = supervised.id;
    this.activeProcesses.set(procId, { supervised, runId: request.runId, contextId: request.contextId });

    try {
      const info = await supervised.join(request.timeoutMs ?? 120_000);
      const stdout = supervised.stdout.toString();
      const stderr = supervised.stderr.toString();

      if (info.reason === 'spawn_failed') {
        return {
          exitCode: 2,
          stdout,
          stderr: info.error?.message || stderr || 'spawn failed',
          duration_ms: nowMs() - startTime,
        };
      }
      if (info.reason === 'timeout') {
        return {
          exitCode: 124,
          stdout,
          stderr: stderr || `Process timeout after ${request.timeoutMs}ms`,
          duration_ms: nowMs() - startTime,
        };
      }
      if (info.reason === 'unconfirmed_orphan') {
        return {
          exitCode: 1,
          processExitReason: 'unconfirmed_orphan',
          stdout,
          stderr: stderr || 'Process termination was not confirmed; the process is quarantined as an orphan.',
          duration_ms: nowMs() - startTime,
        };
      }
      return {
        exitCode: resolveExitCode(info.code, info.signal),
        stdout,
        stderr,
        duration_ms: nowMs() - startTime,
      };
    } finally {
      if (supervised.orphaned) {
        void supervised.exit.then(() => { this.activeProcesses.delete(procId); });
      } else {
        this.activeProcesses.delete(procId);
      }
    }
  }

  hasUnconfirmedProcesses(contextId?: string): boolean {
    return Array.from(this.activeProcesses.values()).some(({ supervised, contextId: owner }) => supervised.orphaned && (!contextId || owner === contextId));
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
