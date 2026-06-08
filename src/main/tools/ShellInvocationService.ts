import { spawn, type ChildProcess } from 'child_process';
import { generateEventId, nowMs } from '@shared/utils/id';
import type { CLIResult } from '@shared/types/tool';

export interface ShellInvocationRequest {
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
  runId?: string;
  abortSignal?: AbortSignal;
}

export class ShellInvocationService {
  private activeProcesses = new Map<string, { process: ChildProcess; runId?: string }>();

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

    return new Promise((resolve) => {
      const proc = spawn(command, request.args ?? [], {
        cwd: request.cwd || undefined,
        env: {
          ...process.env,
          ...request.env,
          PYTHONIOENCODING: 'utf-8',
        },
        shell: true,
        windowsHide: true,
      });
      const procId = generateEventId('proc');
      this.activeProcesses.set(procId, { process: proc, runId: request.runId });

      let stdout = '';
      let stderr = '';
      let timeoutId: NodeJS.Timeout | null = null;
      let settled = false;

      const abortHandler = () => {
        try {
          proc.kill();
        } catch {
          // noop
        }
      };

      const finalize = (result: CLIResult) => {
        if (settled) return;
        settled = true;
        if (timeoutId) clearTimeout(timeoutId);
        this.activeProcesses.delete(procId);
        request.abortSignal?.removeEventListener('abort', abortHandler);
        resolve(result);
      };

      if (request.timeoutMs) {
        timeoutId = setTimeout(() => {
          abortHandler();
          finalize({
            exitCode: 124,
            stdout,
            stderr: stderr || `Process timeout after ${request.timeoutMs}ms`,
            duration_ms: nowMs() - startTime,
          });
        }, request.timeoutMs);
      }

      if (request.abortSignal) {
        if (request.abortSignal.aborted) {
          abortHandler();
        } else {
          request.abortSignal.addEventListener('abort', abortHandler, { once: true });
        }
      }

      proc.stdout?.on('data', (data) => {
        stdout += data.toString('utf-8');
      });

      proc.stderr?.on('data', (data) => {
        stderr += data.toString('utf-8');
      });

      proc.on('close', (code) => {
        finalize({
          exitCode: code ?? 0,
          stdout,
          stderr,
          duration_ms: nowMs() - startTime,
        });
      });

      proc.on('error', (error) => {
        finalize({
          exitCode: 2,
          stdout,
          stderr: error instanceof Error ? error.message : String(error),
          duration_ms: nowMs() - startTime,
        });
      });
    });
  }

  abortRun(runId: string): void {
    for (const { process, runId: activeRunId } of this.activeProcesses.values()) {
      if (activeRunId !== runId) continue;
      try {
        process.kill();
      } catch {
        // noop
      }
    }
  }

  terminateAll(): void {
    for (const active of this.activeProcesses.values()) {
      try {
        active.process.kill();
      } catch {
        // noop
      }
    }
    this.activeProcesses.clear();
  }
}

export const shellInvocationService = new ShellInvocationService();
