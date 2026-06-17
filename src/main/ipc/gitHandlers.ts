import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { ipcMain } from 'electron';
import type {
  GitActionResult,
  GitCommitRequest,
  GitDiffRequest,
  GitDiffResult,
  GitFileChangeKind,
  GitStatusFile,
  GitStatusSummary,
} from '@shared/types/git';
import { storageAdapter } from '../sessions/StorageAdapter';
import type { WorkbenchIpcContext } from './workbenchContext';

const execFileAsync = promisify(execFile);
const DEFAULT_MAX_BUFFER = 2 * 1024 * 1024;
const DEFAULT_DIFF_BYTES = 128 * 1024;

interface GitCommandOutput {
  stdout: string;
  stderr: string;
}

interface CurrentGitProject {
  projectId: string;
  projectRoot: string;
  gitRoot: string;
}

async function runGit(cwd: string, args: string[], maxBuffer = DEFAULT_MAX_BUFFER): Promise<GitCommandOutput> {
  try {
    const result = await execFileAsync('git', ['-c', 'core.quotepath=false', ...args], {
      cwd,
      encoding: 'utf8',
      maxBuffer,
      windowsHide: true,
    });
    return {
      stdout: String(result.stdout ?? ''),
      stderr: String(result.stderr ?? ''),
    };
  } catch (error) {
    const err = error as Error & { stdout?: string | Buffer; stderr?: string | Buffer };
    const stderr = String(err.stderr ?? '');
    const stdout = String(err.stdout ?? '');
    throw new Error((stderr || stdout || err.message).trim());
  }
}

async function resolveCurrentGitProject(context: WorkbenchIpcContext): Promise<CurrentGitProject> {
  const projectId = context.state.currentProjectId;
  if (!projectId) {
    throw new Error('No project is selected.');
  }

  const project = storageAdapter.getProjectById(projectId);
  if (!project) {
    throw new Error(`Project not found: ${projectId}`);
  }

  const projectRoot = path.resolve(project.rootPath);
  const { stdout } = await runGit(projectRoot, ['rev-parse', '--show-toplevel']);
  const gitRoot = path.resolve(stdout.trim());
  if (!gitRoot) {
    throw new Error('Current project is not a git repository.');
  }

  return {
    projectId,
    projectRoot,
    gitRoot,
  };
}

function validateGitPath(input: string): string {
  const value = String(input ?? '').trim().replace(/\\/g, '/');
  if (!value) {
    throw new Error('Path is required.');
  }
  if (value.includes('\0') || value.startsWith('/') || /^[A-Za-z]:/.test(value)) {
    throw new Error(`Invalid git path: ${input}`);
  }
  const segments = value.split('/');
  if (segments.includes('..')) {
    throw new Error(`Invalid git path: ${input}`);
  }
  return value;
}

function parseBranchLine(line: string): Pick<GitStatusSummary, 'branch' | 'upstream' | 'ahead' | 'behind'> {
  const content = line.replace(/^##\s*/, '').trim();
  let branch = content;
  let upstream: string | undefined;
  let ahead = 0;
  let behind = 0;

  const trackingMatch = content.match(/\s+\[([^\]]+)\]$/);
  const tracking = trackingMatch?.[1];
  const withoutTracking = trackingMatch ? content.slice(0, trackingMatch.index).trim() : content;
  const upstreamParts = withoutTracking.split('...');
  branch = upstreamParts[0]?.trim() || 'HEAD';
  upstream = upstreamParts[1]?.trim() || undefined;

  if (branch.startsWith('No commits yet on ')) {
    branch = branch.replace('No commits yet on ', '').trim();
  }

  if (tracking) {
    const aheadMatch = tracking.match(/ahead\s+(\d+)/);
    const behindMatch = tracking.match(/behind\s+(\d+)/);
    ahead = aheadMatch ? Number(aheadMatch[1]) : 0;
    behind = behindMatch ? Number(behindMatch[1]) : 0;
  }

  return { branch, upstream, ahead, behind };
}

function resolveChangeKind(indexStatus: string, workingTreeStatus: string): GitFileChangeKind {
  const joined = `${indexStatus}${workingTreeStatus}`;
  if (joined.includes('?')) return 'untracked';
  if (joined.includes('U')) return 'unmerged';
  if (joined.includes('R')) return 'renamed';
  if (joined.includes('C')) return 'copied';
  if (joined.includes('A')) return 'added';
  if (joined.includes('D')) return 'deleted';
  if (joined.includes('T')) return 'typechange';
  if (joined.includes('M')) return 'modified';
  return 'unknown';
}

function parseStatusFile(line: string): GitStatusFile | null {
  if (line.length < 4) {
    return null;
  }

  const indexStatus = line[0] === ' ' ? '' : line[0];
  const workingTreeStatus = line[1] === ' ' ? '' : line[1];
  const rawPath = line.slice(3).trim();
  if (!rawPath) {
    return null;
  }

  const renameParts = rawPath.split(' -> ');
  const isRename = renameParts.length === 2;
  const filePath = isRename ? renameParts[1] : rawPath;
  const originalPath = isRename ? renameParts[0] : undefined;

  return {
    path: filePath,
    originalPath,
    indexStatus,
    workingTreeStatus,
    kind: resolveChangeKind(indexStatus, workingTreeStatus),
    staged: Boolean(indexStatus && indexStatus !== '?'),
    unstaged: Boolean(workingTreeStatus || indexStatus === '?'),
  };
}

function parseStatus(project: CurrentGitProject, output: string): GitStatusSummary {
  const lines = output.split(/\r?\n/).filter((line) => line.length > 0);
  const branchLine = lines.find((line) => line.startsWith('## ')) ?? '## HEAD';
  const branch = parseBranchLine(branchLine);
  const files = lines
    .filter((line) => !line.startsWith('## '))
    .map(parseStatusFile)
    .filter((file): file is GitStatusFile => Boolean(file));

  return {
    projectId: project.projectId,
    rootPath: project.gitRoot,
    ...branch,
    clean: files.length === 0,
    files,
    stagedCount: files.filter((file) => file.staged).length,
    unstagedCount: files.filter((file) => file.unstaged).length,
    untrackedCount: files.filter((file) => file.kind === 'untracked').length,
  };
}

async function getStatus(context: WorkbenchIpcContext): Promise<GitStatusSummary> {
  const project = await resolveCurrentGitProject(context);
  const { stdout } = await runGit(project.gitRoot, ['status', '--porcelain=v1', '-b', '-uall']);
  return parseStatus(project, stdout);
}

function truncate(text: string, maxBytes: number): { text: string; truncated: boolean } {
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) {
    return { text, truncated: false };
  }
  const headBytes = Math.floor(maxBytes * 0.75);
  const tailBytes = Math.floor(maxBytes * 0.15);
  return {
    text: `${text.slice(0, headBytes)}\n... [truncated] ...\n${text.slice(text.length - tailBytes)}`,
    truncated: true,
  };
}

async function getDiff(context: WorkbenchIpcContext, request?: GitDiffRequest): Promise<GitDiffResult> {
  try {
    const project = await resolveCurrentGitProject(context);
    const pathspec = request?.path ? ['--', validateGitPath(request.path)] : [];
    const scope = request?.staged ? ['--cached'] : [];
    const [{ stdout: stat }, { stdout: patch }] = await Promise.all([
      runGit(project.gitRoot, ['diff', '--stat', ...scope, ...pathspec]),
      runGit(project.gitRoot, ['diff', ...scope, ...pathspec], DEFAULT_MAX_BUFFER),
    ]);
    const maxBytes = Math.max(1024, Math.min(request?.maxBytes ?? DEFAULT_DIFF_BYTES, DEFAULT_MAX_BUFFER));
    const truncated = truncate(patch || stat || 'No diff.', maxBytes);
    return {
      success: true,
      rootPath: project.gitRoot,
      stat: stat || 'No diff.',
      patch: truncated.text,
      truncated: truncated.truncated,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function runGitAction(
  context: WorkbenchIpcContext,
  args: string[],
): Promise<GitActionResult> {
  try {
    const project = await resolveCurrentGitProject(context);
    const { stdout, stderr } = await runGit(project.gitRoot, args);
    return {
      success: true,
      status: await getStatus(context),
      output: [stdout.trim(), stderr.trim()].filter(Boolean).join('\n'),
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function failGitAction(error: unknown): GitActionResult {
  return {
    success: false,
    error: error instanceof Error ? error.message : String(error),
  };
}

export function registerGitHandlers(context: WorkbenchIpcContext): void {
  ipcMain.handle('git:getStatus', async () => {
    try {
      return {
        success: true,
        status: await getStatus(context),
      } satisfies GitActionResult;
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      } satisfies GitActionResult;
    }
  });

  ipcMain.handle('git:getDiff', async (_event, request?: GitDiffRequest) => getDiff(context, request));

  ipcMain.handle('git:stage', async (_event, request: { path: string }) => {
    try {
      return await runGitAction(context, ['add', '--', validateGitPath(request.path)]);
    } catch (error) {
      return failGitAction(error);
    }
  });

  ipcMain.handle('git:stageAll', async () => runGitAction(context, ['add', '--all']));

  ipcMain.handle('git:unstage', async (_event, request: { path: string }) => {
    try {
      return await runGitAction(context, ['restore', '--staged', '--', validateGitPath(request.path)]);
    } catch (error) {
      return failGitAction(error);
    }
  });

  ipcMain.handle('git:unstageAll', async () => runGitAction(context, ['restore', '--staged', '--', '.']));

  ipcMain.handle('git:commit', async (_event, request: GitCommitRequest) => {
    const message = String(request?.message ?? '').trim();
    if (!message) {
      return { success: false, error: 'Commit message is required.' } satisfies GitActionResult;
    }
    return runGitAction(context, ['commit', '-m', message]);
  });
}
