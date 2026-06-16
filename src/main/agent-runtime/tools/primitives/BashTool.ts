/**
 * BashTool — 在 workspace 目录执行 shell 命令。
 *
 * - 跨平台：Windows 走 cmd.exe /d /s /c，其它平台走 /bin/sh -c。
 * - 输出捕获 stdout + stderr，并合并展示。
 * - 默认超时 120s，可通过 `timeout` 参数覆盖（毫秒）。
 * - 超过 50KB 自动截断。
 * - 监听 AbortSignal，触发时 SIGTERM 终止子进程。
 */

import { spawn } from 'child_process';
import type { AgentTool, AgentToolResult } from '../../agent/AgentTool';
import { getBackgroundTaskRunner } from '../../scheduler';
import { getWorkspaceRoot, truncateOutput } from './_shared';

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

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_BYTES = 50 * 1024;

export const bashTool: AgentTool<BashParams, BashDetails> = {
  name: 'bash',
  label: '终端命令',
  description:
    'Run a shell command in the workspace directory. Use for file operations, git, build tools, etc. Output is captured (stdout+stderr) and truncated at 50KB.',
  parameters: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'The shell command to execute',
      },
      timeout: {
        type: 'number',
        description: 'Timeout in milliseconds (default: 120000)',
      },
      run_in_background: {
        type: 'boolean',
        description:
          'Run the command in the background without waiting for completion',
      },
    },
    required: ['command'],
  },
  permissionHint: 'mutation',

  async execute(_toolCallId, params, signal, onUpdate) {
    const command = params.command;
    const timeoutMs = params.timeout ?? DEFAULT_TIMEOUT_MS;
    const cwd = getWorkspaceRoot();
    const startedAt = Date.now();

    // 后台模式：交给 BackgroundTaskRunner，立即返回 bgTaskId。
    if (params.run_in_background === true) {
      const runner = getBackgroundTaskRunner();
      const bgTaskId = runner.startBackground(command, cwd, signal);
      const text =
        `[Background task ${bgTaskId} started]\n` +
        `Command: ${command}\n` +
        `Result will be delivered via background task notification when complete.`;
      return {
        content: [{ type: 'text', text }],
        details: {
          command,
          exitCode: null,
          signal: null,
          durationMs: Date.now() - startedAt,
          truncated: false,
          cwd,
          bgTaskId,
        },
      };
    }

    const isWindows = process.platform === 'win32';
    const shell = isWindows ? process.env.ComSpec || 'cmd.exe' : '/bin/sh';
    const shellArgs = isWindows ? ['/d', '/s', '/c', command] : ['-c', command];

    return await new Promise<AgentToolResult<BashDetails>>((resolve) => {
      let stdout = '';
      let stderr = '';
      let timedOut = false;
      let aborted = false;

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

      const emitUpdate = (): void => {
        if (!onUpdate) return;
        const text = combineOutput(stdout, stderr);
        onUpdate({
          content: [{ type: 'text', text: truncateOutput(text, MAX_OUTPUT_BYTES) }],
        });
      };

      child.stdout?.on('data', (chunk: Buffer | string) => {
        stdout += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
        emitUpdate();
      });
      child.stderr?.on('data', (chunk: Buffer | string) => {
        stderr += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
        emitUpdate();
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        if (signal) signal.removeEventListener('abort', onAbort);
        const text = combineOutput(stdout, stderr) + `\n[spawn error] ${err.message}`;
        const truncated = Buffer.byteLength(text, 'utf8') > MAX_OUTPUT_BYTES;
        resolve({
          content: [
            { type: 'text', text: truncateOutput(text, MAX_OUTPUT_BYTES) },
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
        const truncated = Buffer.byteLength(combined, 'utf8') > MAX_OUTPUT_BYTES;
        resolve({
          content: [
            { type: 'text', text: truncateOutput(combined, MAX_OUTPUT_BYTES) },
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
