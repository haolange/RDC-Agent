import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import type { AgentTool, AgentToolResult } from '../../agent/AgentTool';
import { getWorkspaceRoot, truncateOutput } from './_shared';

const execFileAsync = promisify(execFile);
const MAX_OUTPUT_BYTES = 64 * 1024;

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

async function runGit(cwd: string, args: string[]): Promise<GitOutput> {
  try {
    const result = await execFileAsync('git', ['-c', 'core.quotepath=false', ...args], {
      cwd,
      encoding: 'utf8',
      maxBuffer: MAX_OUTPUT_BYTES * 2,
      windowsHide: true,
    });
    return {
      stdout: String(result.stdout ?? ''),
      stderr: String(result.stderr ?? ''),
    };
  } catch (error) {
    const err = error as Error & { stdout?: string | Buffer; stderr?: string | Buffer };
    const output = [String(err.stdout ?? '').trim(), String(err.stderr ?? '').trim(), err.message]
      .filter(Boolean)
      .join('\n');
    throw new Error(output);
  }
}

async function resolveGitRoot(workspaceRoot: string): Promise<string> {
  const output = await runGit(workspaceRoot, ['rev-parse', '--show-toplevel']);
  return path.resolve(output.stdout.trim());
}

function validateGitPath(input: string): string {
  const value = String(input ?? '').trim().replace(/\\/g, '/');
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
    content: [{ type: 'text', text: truncateOutput(output || 'No output.', MAX_OUTPUT_BYTES) }],
    details: { cwd, args },
  };
}

async function executeGit(
  args: string[],
  contextRoot: string,
): Promise<AgentToolResult<GitDetails>> {
  const gitRoot = await resolveGitRoot(contextRoot);
  const output = await runGit(gitRoot, args);
  const text = [output.stdout.trim(), output.stderr.trim()]
    .filter(Boolean)
    .join('\n');
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
  spec: { isReadOnly: true, isConcurrencySafe: true, isDestructive: false, sideEffect: 'none', category: 'system', requiresApproval: false },
  permissionHint: 'readonly',

  async execute(_toolCallId, params, _signal, _onUpdate, context) {
    const root = getWorkspaceRoot(context);
    const args = params.short === false
      ? ['status', '-sb']
      : ['status', '--porcelain=v1', '-b', '-uall'];
    return executeGit(args, root);
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
  spec: { isReadOnly: true, isConcurrencySafe: true, isDestructive: false, sideEffect: 'none', category: 'system', requiresApproval: false },
  permissionHint: 'readonly',

  async execute(_toolCallId, params, _signal, _onUpdate, context) {
    const root = getWorkspaceRoot(context);
    const args = ['diff'];
    if (params.stat) args.push('--stat');
    if (params.staged) args.push('--cached');
    if (params.path) args.push('--', validateGitPath(params.path));
    return executeGit(args, root);
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
  spec: { isReadOnly: true, isConcurrencySafe: true, isDestructive: false, sideEffect: 'none', category: 'system', requiresApproval: false },
  permissionHint: 'readonly',

  async execute(_toolCallId, params, _signal, _onUpdate, context) {
    const root = getWorkspaceRoot(context);
    const limit = Math.max(1, Math.min(50, Math.floor(params.limit ?? 10)));
    return executeGit(['log', '--oneline', `-${limit}`], root);
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
  spec: { isReadOnly: false, isConcurrencySafe: false, isDestructive: false, sideEffect: 'filesystem', category: 'system', requiresApproval: true },
  permissionHint: 'mutation',

  async execute(_toolCallId, params, _signal, _onUpdate, context) {
    const root = getWorkspaceRoot(context);
    return executeGit(['add', '--', validateGitPath(params.path)], root);
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
  spec: { isReadOnly: false, isConcurrencySafe: false, isDestructive: false, sideEffect: 'filesystem', category: 'system', requiresApproval: true },
  permissionHint: 'mutation',

  async execute(_toolCallId, params, _signal, _onUpdate, context) {
    const root = getWorkspaceRoot(context);
    return executeGit(['restore', '--staged', '--', validateGitPath(params.path)], root);
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
  spec: { isReadOnly: false, isConcurrencySafe: false, isDestructive: false, sideEffect: 'filesystem', category: 'system', requiresApproval: true },
  permissionHint: 'mutation',

  async execute(_toolCallId, params, _signal, _onUpdate, context) {
    const message = String(params.message ?? '').trim();
    if (!message) {
      throw new Error('Commit message is required.');
    }
    const root = getWorkspaceRoot(context);
    return executeGit(['commit', '-m', message], root);
  },
};
