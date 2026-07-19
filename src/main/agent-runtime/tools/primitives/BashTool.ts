/**
 * BashTool — 在 workspace 目录执行 shell 命令。
 *
 * - 跨平台：Windows 走 cmd.exe /d /s /c，其它平台走 /bin/sh -c。
 * - 输出捕获 stdout + stderr，并合并展示。
 * - 默认超时 120s，timeout 有硬顶；输出按字节硬截断。
 * - 监听 AbortSignal，触发时 SIGTERM 终止子进程。
 * - run_in_background 未闭环前 fail-closed 拒绝。
 */

import { spawn } from 'child_process';
import type { AgentTool, AgentToolResult } from '../../agent/AgentTool';
import { getWorkspaceRoot, truncateOutput } from './_shared';
import {
  BASH_DEFAULT_TIMEOUT_MS,
  BASH_MAX_OUTPUT_BYTES,
  BASH_MAX_TIMEOUT_MS,
} from './toolLimits';

interface BashParams {
  command: string;
  timeout?: number;
  run_in_background?: boolean;
}

interface BashDetails {
  command: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  durationMs: number;
  truncated: boolean;
  cwd: string;
  /** 当 run_in_background=true 时填充，指向 BackgroundTaskRunner 的任务 ID。 */
  bgTaskId?: string;
}

export const bashTool: AgentTool<BashParams, BashDetails> = {
  name: 'bash',
  label: '终端命令',
  description:
    'Run a shell command in the workspace directory. Use for file operations, git, build tools, etc. Output is captured (stdout+stderr) and truncated at 50KB. Background execution is currently disabled.',
  parameters: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'The shell command to execute',
      },
      timeout: {
        type: 'number',
        description: `Timeout in milliseconds (default: ${BASH_DEFAULT_TIMEOUT_MS}, max: ${BASH_MAX_TIMEOUT_MS})`,
      },
      run_in_background: {
        type: 'boolean',
        description:
          'Background execution is not available; requests with true are rejected.',
      },
    },
    required: ['command'],
  },
  spec: { isReadOnly: false, isConcurrencySafe: false, isDestructive: true, sideEffect: 'process', category: 'system', requiresApproval: true },
  permissionHint: 'mutation',

  async execute(_toolCallId, params, signal, onUpdate, context) {
    const command = params.command;
    const timeoutMs = Math.max(
      1,
      Math.min(
        BASH_MAX_TIMEOUT_MS,
        Math.floor(Number.isFinite(params.timeout) ? Number(params.timeout) : BASH_DEFAULT_TIMEOUT_MS),
      ),
    );
    const cwd = getWorkspaceRoot(context);
    const startedAt = Date.now();

    if (params.run_in_background === true) {
      throw new Error(
        'bash run_in_background is disabled until background task results are wired into the agent loop.',
      );
    }

    const isWindows = process.platform === 'win32';
    const shell = isWindows ? process.env.ComSpec || 'cmd.exe' : '/bin/sh';
    const shellArgs = isWindows ? ['/d', '/s', '/c', command] : ['-c', command];

    return await new Promise<AgentToolResult<BashDetails>>((resolve) => {
      let stdout = '';
      let stderr = '';
      let timedOut = false;
      let aborted = false;
      let outputCapped = false;

      const child = spawn(shell, shellArgs, {
        cwd,
        env: process.env,
        windowsHide: true,
      });

      const timer = setTimeout(() => {
        timedOut = true;
        try {
          child.kill('SIGTERM');
        } catch {
          /* ignore */
        }
      }, timeoutMs);

      const onAbort = (): void => {
        aborted = true;
        try {
          child.kill('SIGTERM');
        } catch {
          /* ignore */
        }
      };
      if (signal) {
        if (signal.aborted) {
          onAbort();
        } else {
          signal.addEventListener('abort', onAbort, { once: true });
        }
      }

      const appendBounded = (current: string, chunk: Buffer | string): string => {
        if (outputCapped) return current;
        const next = current + (typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
        if (Buffer.byteLength(next, 'utf8') <= BASH_MAX_OUTPUT_BYTES * 2) {
          return next;
        }
        outputCapped = true;
        return truncateOutput(next, BASH_MAX_OUTPUT_BYTES * 2);
      };

      const emitUpdate = (): void => {
        if (!onUpdate) return;
        const text = combineOutput(stdout, stderr);
        onUpdate({
          content: [{ type: 'text', text: truncateOutput(text, BASH_MAX_OUTPUT_BYTES) }],
        });
      };

      child.stdout?.on('data', (chunk: Buffer | string) => {
        stdout = appendBounded(stdout, chunk);
        emitUpdate();
      });
      child.stderr?.on('data', (chunk: Buffer | string) => {
        stderr = appendBounded(stderr, chunk);
        emitUpdate();
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        if (signal) signal.removeEventListener('abort', onAbort);
        const text = combineOutput(stdout, stderr) + `\n[spawn error] ${err.message}`;
        const truncated = Buffer.byteLength(text, 'utf8') > BASH_MAX_OUTPUT_BYTES;
        resolve({
          content: [
            { type: 'text', text: truncateOutput(text, BASH_MAX_OUTPUT_BYTES) },
          ],
          details: {
            command,
            exitCode: null,
            signal: null,
            durationMs: Date.now() - startedAt,
            truncated,
            cwd,
          },
        });
      });

      child.on('close', (code, sig) => {
        clearTimeout(timer);
        if (signal) signal.removeEventListener('abort', onAbort);
        let combined = combineOutput(stdout, stderr);
        if (timedOut) {
          combined += `\n[timeout] command exceeded ${timeoutMs}ms`;
        }
        if (aborted) {
          combined += `\n[aborted]`;
        }
        const truncated = Buffer.byteLength(combined, 'utf8') > BASH_MAX_OUTPUT_BYTES || outputCapped;
        resolve({
          content: [
            { type: 'text', text: truncateOutput(combined, BASH_MAX_OUTPUT_BYTES) },
          ],
          details: {
            command,
            exitCode: code,
            signal: sig,
            durationMs: Date.now() - startedAt,
            truncated,
            cwd,
          },
        });
      });
    });
  },
};

function combineOutput(stdout: string, stderr: string): string {
  if (!stderr) return stdout;
  if (!stdout) return stderr;
  return `${stdout}\n${stderr}`;
}
