/**
 * Worktree 隔离管理器。
 *
 * 为每个子 Agent 提供独立的 git worktree 目录，
 * 避免多 Agent 并发修改同一工作区造成冲突。
 * 内部通过 `git worktree add/remove/list` 命令实现。
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as path from 'node:path';

const execFileAsync = promisify(execFile);

/** 合法 worktree / 分支名（字母、数字、点、下划线、横线，1-64 字符）。 */
const VALID_WORKTREE_NAME = /^[A-Za-z0-9._-]{1,64}$/;

/** 单个 git worktree 的元数据。 */
export interface WorktreeInfo {
  /** worktree 路径。 */
  path: string;
  /** 关联的分支名。 */
  branch: string;
  /** HEAD commit hash。 */
  head: string;
  /** 是否为主工作区。 */
  isMain: boolean;
  /** 绑定的 Agent ID（如有）。 */
  agentId?: string;
}

/** 创建 worktree 的可选参数。 */
export interface CreateWorktreeOptions {
  /** 基于哪个 commit/branch 创建，默认 HEAD。 */
  base?: string;
  /** worktree 存放的父目录，默认 {repoRoot}/.worktrees/ */
  parentDir?: string;
}

/** execGit 错误：git 命令以非零退出或不可用。 */
export class GitCommandError extends Error {
  /** 退出码（execFile 失败时由 errno/code 提供）。 */
  readonly exitCode: number | null;
  /** 完整 stderr 输出。 */
  readonly stderr: string;
  /** 执行的参数。 */
  readonly args: readonly string[];

  constructor(message: string, args: readonly string[], exitCode: number | null, stderr: string) {
    super(message);
    this.name = 'GitCommandError';
    this.args = args;
    this.exitCode = exitCode;
    this.stderr = stderr;
  }
}

/**
 * git worktree 生命周期管理器。
 *
 * 维护 agentId → worktree 路径的内存绑定，
 * 真实文件状态通过 `git worktree list --porcelain` 查询。
 * 所有 git 调用都通过 execFile 执行，避免 shell 注入。
 */
export class WorktreeManager {
  /** git 仓库根目录的绝对路径。 */
  private readonly repoRoot: string;
  /** agentId → worktreePath 的内存绑定表。 */
  private readonly agentBindings = new Map<string, string>();

  constructor(repoRoot: string) {
    if (!repoRoot) {
      throw new Error('WorktreeManager: repoRoot is required');
    }
    this.repoRoot = path.resolve(repoRoot);
  }

  /**
   * 在 `git worktree add` 中以独立分支创建一个新 worktree。
   *
   * 默认存放路径 `{repoRoot}/.worktrees/{branchName}`，
   * 可通过 options.parentDir 覆盖父目录；options.base 指定基线（默认 HEAD）。
   * 返回 worktree 的绝对路径。
   */
  async createWorktree(branchName: string, options: CreateWorktreeOptions = {}): Promise<string> {
    if (!VALID_WORKTREE_NAME.test(branchName)) {
      throw new Error(
        `Invalid worktree branch name "${branchName}": ` +
          'only letters, digits, dots, underscores, dashes (1-64 chars) are allowed',
      );
    }

    const parentDir = options.parentDir
      ? path.resolve(options.parentDir)
      : path.join(this.repoRoot, '.worktrees');
    const worktreePath = path.join(parentDir, branchName);
    const base = options.base ?? 'HEAD';

    try {
      await this.execGit(['worktree', 'add', worktreePath, '-b', branchName, base]);
    } catch (err) {
      if (err instanceof GitCommandError) {
        throw new Error(
          `Failed to create worktree "${branchName}" at ${worktreePath}: ${err.stderr || err.message}`,
        );
      }
      throw err;
    }
    return worktreePath;
  }

  /**
   * 删除指定路径的 worktree。
   *
   * 使用 `--force` 以确保即使存在未提交修改也能移除；
   * 调用方需自行评估丢弃风险。
   */
  async removeWorktree(worktreePath: string): Promise<void> {
    if (!worktreePath) {
      throw new Error('removeWorktree: worktreePath is required');
    }
    const absolutePath = path.resolve(worktreePath);

    try {
      await this.execGit(['worktree', 'remove', absolutePath, '--force']);
    } catch (err) {
      if (err instanceof GitCommandError) {
        throw new Error(
          `Failed to remove worktree at ${absolutePath}: ${err.stderr || err.message}`,
        );
      }
      throw err;
    }

    // 解除所有指向该路径的 agent 绑定
    for (const [agentId, boundPath] of this.agentBindings.entries()) {
      if (path.resolve(boundPath) === absolutePath) {
        this.agentBindings.delete(agentId);
      }
    }
  }

  /**
   * 列出当前仓库的所有 worktree。
   *
   * 通过解析 `git worktree list --porcelain` 输出生成结构化数据，
   * 并填充 agentId（若该路径已被 bind 到某个 agent）。
   */
  async listWorktrees(): Promise<WorktreeInfo[]> {
    const output = await this.execGit(['worktree', 'list', '--porcelain']);
    const infos = parsePorcelain(output);

    // 反向索引绑定，便于回填 agentId
    const pathToAgent = new Map<string, string>();
    for (const [agentId, boundPath] of this.agentBindings.entries()) {
      pathToAgent.set(path.resolve(boundPath), agentId);
    }

    return infos.map((info) => {
      const agentId = pathToAgent.get(path.resolve(info.path));
      return agentId ? { ...info, agentId } : info;
    });
  }

  /** 在内存中记录 agentId → worktreePath 绑定。 */
  bindToAgent(agentId: string, worktreePath: string): void {
    if (!agentId) {
      throw new Error('bindToAgent: agentId is required');
    }
    if (!worktreePath) {
      throw new Error('bindToAgent: worktreePath is required');
    }
    this.agentBindings.set(agentId, path.resolve(worktreePath));
  }

  /** 查询 agentId 绑定的 worktree 路径。 */
  getAgentWorktree(agentId: string): string | undefined {
    return this.agentBindings.get(agentId);
  }

  /** 解除 agentId 的绑定（worktree 物理目录不受影响）。 */
  unbindAgent(agentId: string): void {
    this.agentBindings.delete(agentId);
  }

  /**
   * 清理所有非主工作区的 worktree，并清空内存绑定。
   *
   * 用于应用退出或全局重置场景。
   * 单个 worktree 删除失败不会中断后续清理，
   * 但首个错误会在所有清理结束后抛出。
   */
  async cleanup(): Promise<void> {
    let firstError: Error | undefined;
    try {
      const worktrees = await this.listWorktrees();
      for (const wt of worktrees) {
        if (wt.isMain) continue;
        try {
          await this.removeWorktree(wt.path);
        } catch (err) {
          if (!firstError) {
            firstError = err instanceof Error ? err : new Error(String(err));
          }
        }
      }
    } finally {
      this.agentBindings.clear();
    }
    if (firstError) {
      throw firstError;
    }
  }

  /**
   * 在 repoRoot 下执行 git 命令并返回 stdout。
   *
   * 失败时抛出 GitCommandError，包含退出码和 stderr。
   */
  private async execGit(args: string[]): Promise<string> {
    try {
      const { stdout } = await execFileAsync('git', args, {
        cwd: this.repoRoot,
        maxBuffer: 10 * 1024 * 1024,
        windowsHide: true,
      });
      return stdout;
    } catch (rawErr) {
      const err = rawErr as {
        message?: string;
        stderr?: string;
        stdout?: string;
        code?: number | string;
      };
      // git 不可用：execFile 抛出 ENOENT
      if (err.code === 'ENOENT') {
        throw new GitCommandError(
          'git executable not found in PATH',
          args,
          null,
          err.message ?? '',
        );
      }
      const stderr = (err.stderr ?? '').toString().trim();
      const exitCode = typeof err.code === 'number' ? err.code : null;
      throw new GitCommandError(
        `git ${args.join(' ')} failed${exitCode !== null ? ` (exit ${exitCode})` : ''}`,
        args,
        exitCode,
        stderr || (err.message ?? ''),
      );
    }
  }
}

/**
 * 解析 `git worktree list --porcelain` 输出。
 *
 * 各 worktree 间以空行分隔，主工作区为第一个条目。
 * 字段示例：
 *   worktree /path/to/main
 *   HEAD abc123
 *   branch refs/heads/main
 *
 * detached 工作区不会有 branch 行，但会出现 `detached` 标记。
 */
function parsePorcelain(output: string): WorktreeInfo[] {
  const blocks = output
    .split(/\r?\n\r?\n/)
    .map((b) => b.trim())
    .filter((b) => b.length > 0);

  const result: WorktreeInfo[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    let worktreePath = '';
    let head = '';
    let branch = '';
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith('worktree ')) {
        worktreePath = line.slice('worktree '.length).trim();
      } else if (line.startsWith('HEAD ')) {
        head = line.slice('HEAD '.length).trim();
      } else if (line.startsWith('branch ')) {
        // refs/heads/{name} → 截掉前缀
        const ref = line.slice('branch '.length).trim();
        branch = ref.startsWith('refs/heads/') ? ref.slice('refs/heads/'.length) : ref;
      }
    }
    if (!worktreePath) continue;
    result.push({
      path: worktreePath,
      branch,
      head,
      isMain: i === 0,
    });
  }
  return result;
}
