import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { AppError } from '@shared/errors/appError';
import {
  getWorkspaceRoot,
  isWithinRoot,
  requireMutationWorkspaceRoot,
  truncateOutput,
} from '../../../runtime/toolFiles';
import { GIT_MAX_OUTPUT_BYTES, GIT_TIMEOUT_MS } from '../../../runtime/toolLimits';
import type { AgentTool, AgentToolResult } from '../../agent/AgentTool';

const execFileAsync = promisify(execFile);

interface GitStatusParams {
  short?: boolean;
}

interface GitDiffParams {
  path?: string;
  staged?: boolean;
  stat?: boolean;
}

interface GitLogParams {
  limit?: number;
}

interface GitPathParams {
  path: string;
}

interface GitCommitParams {
  message: string;
}

interface GitDetails {
  cwd: string;
  args: string[];
}

interface GitOutput {
  stdout: string;
  stderr: string;
}

/**
 * Command-line config outranks repository config, so these overrides keep a cloned
 * repository from turning an observe-class git call into code execution.
 */
const INERT_GIT_CONFIG = [
  '-c',
  'core.quotepath=false',
  '-c',
  'core.fsmonitor=false',
  '-c',
  `core.hooksPath=${os.devNull}`,
  '-c',
  'core.sshCommand=',
  '-c',
  'diff.external=',
];

/** Repository-local keys that name a program git may run; their presence fails closed. */
const EXECUTABLE_CONFIG_KEY =
  /^(?:core\.(?:fsmonitor|hookspath|sshcommand|pager|editor|askpass)|diff\..+\.(?:textconv|command)|merge\..+\.driver|filter\..+\.(?:clean|smudge|process)|include(?:if\..+)?\.path|credential\..*helper|gpg\..*program|uploadpack\.packobjectshook)$/i;

const GIT_ENVIRONMENT = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' };

async function runGit(cwd: string, args: string[], signal?: AbortSignal): Promise<GitOutput> {
  try {
    const result = await execFileAsync('git', [...INERT_GIT_CONFIG, ...args], {
      cwd,
      encoding: 'utf8',
      env: GIT_ENVIRONMENT,
      maxBuffer: GIT_MAX_OUTPUT_BYTES * 2,
      windowsHide: true,
      timeout: GIT_TIMEOUT_MS,
      signal,
    });
    return { stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    const err = error as Error & { stdout?: string | Buffer; stderr?: string | Buffer; killed?: boolean };
    if (err.killed || /timed out/i.test(err.message)) {
      throw new Error(`git command timed out after ${GIT_TIMEOUT_MS}ms`, { cause: error });
    }
    const output = [String(err.stdout ?? '').trim(), String(err.stderr ?? '').trim(), err.message]
      .filter(Boolean)
      .join('\n');
    throw new Error(output, { cause: error });
  }
}

async function resolveGitRoot(workspaceRoot: string, signal?: AbortSignal): Promise<string> {
  const output = await runGit(workspaceRoot, ['rev-parse', '--show-toplevel'], signal);
  const gitRoot = path.resolve(output.stdout.trim());
  // Accept equal roots, workspace-inside-repo, or repo-inside-workspace; reject unrelated trees.
  const related = isWithinRoot(gitRoot, workspaceRoot) || isWithinRoot(workspaceRoot, gitRoot);
  if (!related) {
    throw new Error(`Git root ${gitRoot} is outside workspace ${workspaceRoot}`);
  }
  return gitRoot;
}

function validateGitPath(input: string): string {
  const value = input.trim().replace(/\\/g, '/');
  if (!value || value.includes('\0') || value.startsWith('/') || /^[A-Za-z]:/.test(value)) {
    throw new Error(`Invalid git path: ${input}`);
  }
  if (value.split('/').includes('..')) {
    throw new Error(`Invalid git path: ${input}`);
  }
  return value;
}

function createResult(cwd: string, args: string[], output: string): AgentToolResult<GitDetails> {
  return {
    content: [{ type: 'text', text: truncateOutput(output || 'No output.', GIT_MAX_OUTPUT_BYTES) }],
    details: { cwd, args },
  };
}

/** `git config --list` only reads files; it never runs a configured program. */
async function assertInertRepositoryConfig(gitRoot: string, signal?: AbortSignal): Promise<void> {
  const output = await runGit(gitRoot, ['config', '--local', '--name-only', '--list'], signal);
  const executable = output.stdout
    .split(/\r?\n/)
    .map((key) => key.trim())
    .filter((key) => EXECUTABLE_CONFIG_KEY.test(key));
  if (executable.length > 0) {
    throw new AppError(
      'GIT_REPOSITORY_CONFIG_EXECUTABLE',
      `repository config names programs git would run (${[...new Set(executable)].join(', ')}). Review the repository configuration before using git tools.`,
    );
  }
}

async function executeGit(
  args: string[],
  contextRoot: string,
  signal?: AbortSignal,
): Promise<AgentToolResult<GitDetails>> {
  const gitRoot = await resolveGitRoot(contextRoot, signal);
  await assertInertRepositoryConfig(gitRoot, signal);
  const output = await runGit(gitRoot, args, signal);
  const text = [output.stdout.trim(), output.stderr.trim()].filter(Boolean).join('\n');
  return createResult(gitRoot, args, text);
}

export const gitStatusTool: AgentTool<GitStatusParams, GitDetails> = {
  name: 'git_status',
  label: 'Git status',
  description: 'Show git status for the current project repository.',
  parameters: {
    type: 'object',
    properties: {
      short: { type: 'boolean', description: 'Use concise porcelain output. Defaults to true.' },
    },
  },
  spec: {
    isReadOnly: true,
    concurrency: 'shared',
    isDestructive: false,
    sideEffect: 'none',
    category: 'system',
    requiresApproval: false,
  },
  permissionHint: 'readonly',

  async execute(_toolCallId, params, signal, _onUpdate, context) {
    const root = getWorkspaceRoot(context);
    const args = params.short === false ? ['status', '-sb'] : ['status', '--porcelain=v1', '-b', '-uall'];
    return executeGit(args, root, signal);
  },
};

export const gitDiffTool: AgentTool<GitDiffParams, GitDetails> = {
  name: 'git_diff',
  label: 'Git diff',
  description: 'Show git diff for the current project repository.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Optional repository-relative path.' },
      staged: { type: 'boolean', description: 'Show staged diff.' },
      stat: { type: 'boolean', description: 'Show diff stat instead of patch.' },
    },
  },
  spec: {
    isReadOnly: true,
    concurrency: 'shared',
    isDestructive: false,
    sideEffect: 'none',
    category: 'system',
    requiresApproval: false,
  },
  permissionHint: 'readonly',

  async execute(_toolCallId, params, signal, _onUpdate, context) {
    const root = getWorkspaceRoot(context);
    const args = ['diff'];
    if (params.stat) args.push('--stat');
    if (params.staged) args.push('--cached');
    if (params.path) args.push('--', validateGitPath(params.path));
    return executeGit(args, root, signal);
  },
};

export const gitLogTool: AgentTool<GitLogParams, GitDetails> = {
  name: 'git_log',
  label: 'Git log',
  description: 'Show recent git commits for the current project repository.',
  parameters: {
    type: 'object',
    properties: {
      limit: { type: 'integer', description: 'Maximum commits to show, 1-50. Defaults to 10.' },
    },
  },
  spec: {
    isReadOnly: true,
    concurrency: 'shared',
    isDestructive: false,
    sideEffect: 'none',
    category: 'system',
    requiresApproval: false,
  },
  permissionHint: 'readonly',

  async execute(_toolCallId, params, signal, _onUpdate, context) {
    const root = getWorkspaceRoot(context);
    const limit = Math.max(1, Math.min(50, Math.floor(params.limit ?? 10)));
    return executeGit(['log', '--oneline', `-${limit}`], root, signal);
  },
};

export const gitAddTool: AgentTool<GitPathParams, GitDetails> = {
  name: 'git_add',
  label: 'Git add',
  description: 'Stage a repository-relative path in the current project repository.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Repository-relative file or directory path to stage.' },
    },
    required: ['path'],
  },
  spec: {
    isReadOnly: false,
    concurrency: 'exclusive',
    isDestructive: false,
    sideEffect: 'filesystem',
    category: 'system',
    requiresApproval: true,
  },
  permissionHint: 'mutation',

  async execute(_toolCallId, params, signal, _onUpdate, context) {
    const root = requireMutationWorkspaceRoot(context);
    return executeGit(['add', '--', validateGitPath(params.path)], root, signal);
  },
};

export const gitUnstageTool: AgentTool<GitPathParams, GitDetails> = {
  name: 'git_unstage',
  label: 'Git unstage',
  description: 'Unstage a repository-relative path in the current project repository.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Repository-relative file or directory path to unstage.' },
    },
    required: ['path'],
  },
  spec: {
    isReadOnly: false,
    concurrency: 'exclusive',
    isDestructive: false,
    sideEffect: 'filesystem',
    category: 'system',
    requiresApproval: true,
  },
  permissionHint: 'mutation',

  async execute(_toolCallId, params, signal, _onUpdate, context) {
    const root = requireMutationWorkspaceRoot(context);
    return executeGit(['restore', '--staged', '--', validateGitPath(params.path)], root, signal);
  },
};

export const gitCommitTool: AgentTool<GitCommitParams, GitDetails> = {
  name: 'git_commit',
  label: 'Git commit',
  description: 'Create a git commit from staged changes in the current project repository.',
  parameters: {
    type: 'object',
    properties: {
      message: { type: 'string', description: 'Commit message.' },
    },
    required: ['message'],
  },
  spec: {
    isReadOnly: false,
    concurrency: 'exclusive',
    isDestructive: false,
    sideEffect: 'filesystem',
    category: 'system',
    requiresApproval: true,
  },
  permissionHint: 'mutation',

  async execute(_toolCallId, params, signal, _onUpdate, context) {
    const message = params.message.trim();
    if (!message) {
      throw new Error('Commit message is required.');
    }
    const root = requireMutationWorkspaceRoot(context);
    return executeGit(['commit', '-m', message], root, signal);
  },
};
