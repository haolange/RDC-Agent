import { executeRdcShell, type RdcShellInput } from '../../../tools/executeRdcShell';
/**
 * ShellTool — spawn a fresh interpreter for each call and persist only cwd.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AgentTool, AgentToolResult } from '../../agent/AgentTool';
import { requireMutationWorkspaceRoot, truncateOutput } from './_shared';
import {
  SHELL_DEFAULT_TIMEOUT_MS,
  SHELL_MAX_OUTPUT_BYTES,
  SHELL_MAX_TIMEOUT_MS,
} from './toolLimits';
import { processSupervisor } from '../../../runtime/ProcessSupervisor';
import { shellResolver, type ShellKind } from '../../../runtime/ShellResolver';
import { describeResolvedShell, resolveConfiguredShell } from '../../../runtime/resolveConfiguredShell';
import { storageAdapter } from '../../../sessions/StorageAdapter';
import {
  buildAgentShellEnv,
  createShellTrailerMarker,
  isPathInsideRoot,
  parseShellTrailer,
  wrapShellCommand,
} from './shellTrailer';

interface ShellParams {
  command?: string;
  rdc?: RdcShellInput;
  timeout?: number;
}

interface ShellDetails {
  command: string;
  reason: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  durationMs: number;
  truncated: boolean;
  cwd: string;
}

const sessionShellLocks = new Map<string, Promise<unknown>>();

function withSessionShellLock<T>(sessionId: string | null, work: () => Promise<T>): Promise<T> {
  if (!sessionId) return work();
  const previous = sessionShellLocks.get(sessionId) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(work);
  sessionShellLocks.set(sessionId, next);
  return next;
}

function resolvePersistedCwd(sessionId: string | null, projectRoot: string): string {
  if (!sessionId) return projectRoot;
  const persisted = storageAdapter.readSessionShellCwd(sessionId);
  if (!persisted) return projectRoot;
  if (!isPathInsideRoot(persisted, projectRoot)) {
    persistCwd(sessionId, projectRoot);
    return projectRoot;
  }
  return persisted;
}

function persistCwd(sessionId: string | null, cwd: string): void {
  if (!sessionId) return;
  try {
    storageAdapter.writeSessionShellCwd(sessionId, cwd);
  } catch {
    /* session may have been removed mid-turn */
  }
}

function resolveReportedExitCode(trailerExit: number | undefined, processCode: number | null): number | null {
  if (typeof trailerExit === 'number' && typeof processCode === 'number' && trailerExit !== processCode) {
    if (trailerExit !== 0) return trailerExit;
    if (processCode !== 0) return processCode;
  }
  if (typeof trailerExit === 'number') return trailerExit;
  return processCode;
}

export const shellTool: AgentTool<ShellParams, Partial<ShellDetails> & { operation?: string; receipt?: import("@shared/types/renderdocInvestigation").InvestigationContentRef }> = {
  name: 'shell',
  label: '终端命令',
  get description() {
    try {
      return describeResolvedShell(resolveConfiguredShell());
    } catch (error) {
      return error instanceof Error
        ? error.message
        : 'SHELL_UNAVAILABLE: No usable shell executable was found.';
    }
  },
  parameters: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'The shell command to execute in the current session working directory',
      },
      rdc: {
        type: 'object', additionalProperties: false,
        oneOf: [{ type: 'object', required: ['operation', 'args'], properties: { operation: {}, args: {}, experimentId: {} }, additionalProperties: false }, { type: 'object', required: ['discovery'], properties: { discovery: {} }, additionalProperties: false }],
        properties: {
          discovery: { type: 'object', additionalProperties: false, properties: { kind: { enum: ['search', 'describe'] }, query: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 20 }, operation: { type: 'string' } }, required: ['kind'], oneOf: [{ type: 'object', properties: { kind: { const: 'search' }, query: {}, limit: {} }, required: ['query'], additionalProperties: false }, { type: 'object', properties: { kind: { const: 'describe' }, operation: {} }, required: ['operation'], additionalProperties: false }] },
          operation: { type: 'string', description: 'Discovered RDC operation allowed by its frozen capability contract. General only.' },
          args: { type: 'object', description: 'Native operation arguments; replay/context identity is injected by main.' },
          experimentId: { type: 'string', description: 'Bind a signed execution receipt to this experiment. Required for investigation closure.' },
        },
      },
      timeout: {
        type: 'number',
        description: `Timeout in milliseconds (default: ${SHELL_DEFAULT_TIMEOUT_MS}, max: ${SHELL_MAX_TIMEOUT_MS})`,
      },
    },
    additionalProperties: false,
    description: 'Provide exactly one of command or rdc. Runtime rejects mixed or empty input.',
  },
  spec: {
    isReadOnly: false,
    isConcurrencySafe: false,
    isDestructive: true,
    sideEffect: 'process',
    category: 'system',
    requiresApproval: true,
  },
  permissionHint: 'mutation',

  async execute(_toolCallId, params, signal, onUpdate, context) {
    if ((typeof params.command === 'string') === Boolean(params.rdc)) throw new Error('SHELL_INPUT: provide exactly one of command or rdc.');
    if (params.rdc) return withSessionShellLock(context?.sessionId ?? null, () => executeRdcShell(params.rdc!, _toolCallId, signal, context));
    return withSessionShellLock(context?.sessionId ?? null, () => executeShellCommand(
      params,
      signal,
      onUpdate,
      context,
    ));
  },
};

async function executeShellCommand(
  params: ShellParams,
  signal: AbortSignal | undefined,
  onUpdate: Parameters<typeof shellTool.execute>[3],
  context: Parameters<typeof shellTool.execute>[4],
): Promise<AgentToolResult<ShellDetails>> {
    const command = params.command!;
    const timeoutMs = Math.max(
      1,
      Math.min(
        SHELL_MAX_TIMEOUT_MS,
        Math.floor(Number.isFinite(params.timeout) ? Number(params.timeout) : SHELL_DEFAULT_TIMEOUT_MS),
      ),
    );
    const projectRoot = requireMutationWorkspaceRoot(context);
    const sessionId = context?.sessionId ?? null;
    const spawnCwd = resolvePersistedCwd(sessionId, projectRoot);
    const startedAt = Date.now();
    const shell = resolveConfiguredShell();
    const marker = createShellTrailerMarker();
    const tempDir = isPosixShellKind(shell.kind)
      ? await mkdtemp(path.join(os.tmpdir(), 'rdc-agent-shell-'))
      : null;
    try {
    const scriptPath = tempDir ? path.join(tempDir, 'command.sh') : undefined;
    if (scriptPath) {
      await writeFile(scriptPath, `${command}\n`, 'utf8');
    }
    const wrapped = wrapShellCommand(command, shell.kind, marker, {
      scriptPath,
      spawnCwd,
    });
    const shellArgs = shellResolver.buildNonInteractiveArgs(shell.kind, wrapped);

    let outputCapped = false;
    let stdout = '';
    let stderr = '';

    const supervised = processSupervisor.spawn('agent-shell', shell.executable, shellArgs, {
      cwd: spawnCwd,
      env: buildAgentShellEnv(),
      windowsHide: true,
      isolateProcessGroup: process.platform !== 'win32',
      timeoutMs,
      abortSignal: signal,
      ringBufferBytes: SHELL_MAX_OUTPUT_BYTES * 2,
    });

    const appendBounded = (current: string, chunk: Buffer | string): string => {
      if (outputCapped) return current;
      const next = current + decodeChunk(chunk);
      if (Buffer.byteLength(next, 'utf8') <= SHELL_MAX_OUTPUT_BYTES * 2) {
        return next;
      }
      outputCapped = true;
      return truncateOutput(next, SHELL_MAX_OUTPUT_BYTES * 2);
    };

    const emitUpdate = (): void => {
      if (!onUpdate) return;
      const parsed = parseShellTrailer(combineOutput(stdout, stderr), marker);
      onUpdate({
        content: [{ type: 'text', text: truncateOutput(parsed.body, SHELL_MAX_OUTPUT_BYTES) }],
      });
    };

    supervised.child.stdout?.on('data', (chunk: Buffer | string) => {
      stdout = appendBounded(stdout, chunk);
      emitUpdate();
    });
    supervised.child.stderr?.on('data', (chunk: Buffer | string) => {
      stderr = appendBounded(stderr, chunk);
      emitUpdate();
    });

    const info = await supervised.join(timeoutMs);
    stdout = supervised.stdout.toString() || stdout;
    stderr = supervised.stderr.toString() || stderr;

    if (info.reason === 'unconfirmed_orphan' || info.reason === 'spawn_failed') {
      const suffix = info.reason === 'unconfirmed_orphan'
        ? '\n[orphan] process termination was not confirmed.'
        : `\n[spawn error] ${info.error?.message ?? 'spawn failed'}`;
      const text = combineOutput(stdout, stderr) + suffix;
      return errorResult(command, info.reason, text, startedAt, spawnCwd, null);
    }

    const parsed = parseShellTrailer(combineOutput(stdout, stderr), marker);
    let body = parsed.body;
    if (info.reason === 'timeout') body += `\n[timeout] command exceeded ${timeoutMs}ms`;
    if (info.reason === 'abort') body += '\n[aborted]';

    let cwd = spawnCwd;
    const diagnostics: string[] = [];
    if (!parsed.trailer) {
      diagnostics.push('[shell] trailer missing; working directory was not updated.');
    } else if (parsed.trailer.provider && parsed.trailer.provider !== 'FileSystem') {
      diagnostics.push(`[shell] cwd provider ${parsed.trailer.provider} is not FileSystem; working directory was not updated.`);
    } else if (parsed.trailer.cwd && !isPathInsideRoot(parsed.trailer.cwd, projectRoot)) {
      diagnostics.push(`[shell] cwd left the project root (${parsed.trailer.cwd}); working directory was not updated.`);
    } else if (parsed.trailer.cwd) {
      cwd = parsed.trailer.cwd;
      persistCwd(sessionId, cwd);
    }

    if (diagnostics.length > 0) {
      body = body ? `${body}\n${diagnostics.join('\n')}` : diagnostics.join('\n');
    }

    const exitCode = resolveReportedExitCode(parsed.trailer?.exit, info.code);
    const failed = info.reason !== 'exit' || exitCode !== 0 || diagnostics.length > 0;
    const truncated = Buffer.byteLength(body, 'utf8') > SHELL_MAX_OUTPUT_BYTES || outputCapped;
    return {
      content: [{ type: 'text', text: truncateOutput(body, SHELL_MAX_OUTPUT_BYTES) }],
      isError: failed,
      details: {
        command,
        reason: info.reason,
        exitCode,
        signal: info.signal,
        durationMs: Date.now() - startedAt,
        truncated,
        cwd,
      },
    };
    } finally {
      if (tempDir) {
        await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
      }
    }
}

function isPosixShellKind(kind: ShellKind): boolean {
  return kind === 'zsh' || kind === 'bash' || kind === 'sh';
}

function decodeChunk(chunk: Buffer | string): string {
  return typeof chunk === 'string' ? chunk : chunk.toString('utf8');
}

function combineOutput(stdout: string, stderr: string): string {
  if (!stderr) return stdout;
  if (!stdout) return stderr;
  return `${stdout}\n${stderr}`;
}

function errorResult(
  command: string,
  reason: string,
  text: string,
  startedAt: number,
  cwd: string,
  exitCode: number | null,
): AgentToolResult<ShellDetails> {
  return {
    content: [{ type: 'text', text: truncateOutput(text, SHELL_MAX_OUTPUT_BYTES) }],
    isError: true,
    details: {
      command,
      reason,
      exitCode,
      signal: null,
      durationMs: Date.now() - startedAt,
      truncated: Buffer.byteLength(text, 'utf8') > SHELL_MAX_OUTPUT_BYTES,
      cwd,
    },
  };
}
