/**
 * WorktreeIsolation — Git worktree 级别的子代理隔离。
 */
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface WorktreeOptions { repoPath: string; branchName?: string; baseRef?: string; }
export interface WorktreeResult { worktreePath: string; branchName: string; }

export class WorktreeIsolation {
  /** 创建一个临时 git worktree 用于隔离执行。 */
  static create(options: WorktreeOptions): WorktreeResult {
    const branchName = options.branchName ?? `rdc-agent-worktree-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const worktreeDir = path.join(os.tmpdir(), `.rdc-worktrees`, branchName);

    const baseRef = options.baseRef ?? 'HEAD';
    execSync(`git -C "${options.repoPath}" worktree add "${worktreeDir}" ${baseRef} -b "${branchName}"`, { stdio: 'pipe' });

    return { worktreePath: worktreeDir, branchName };
  }

  /** 删除 worktree 并清理分支。 */
  static async remove(repoPath: string, worktreePath: string, branchName: string): Promise<void> {
    try {
      execSync(`git -C "${repoPath}" worktree remove "${worktreePath}" --force`, { stdio: 'pipe' });
      execSync(`git -C "${repoPath}" branch -D "${branchName}"`, { stdio: 'pipe' });
    } catch { /* 清理失败不抛错 */ }
    try { fs.rmSync(worktreePath, { recursive: true, force: true }); } catch { /* ignore */ }
  }

  /** 列出所有 worktree。 */
  static list(repoPath: string): Array<{ path: string; branch: string; head: string }> {
    try {
      const output = execSync(`git -C "${repoPath}" worktree list --porcelain`, { encoding: 'utf8' });
      const entries = output.split('\n\n').filter(Boolean);
      return entries.map((entry) => {
        const lines = entry.split('\n');
        const wtPath = lines.find((l) => l.startsWith('worktree '))?.slice(9) ?? '';
        const branch = lines.find((l) => l.startsWith('branch '))?.slice(7) ?? '';
        const head = lines.find((l) => l.startsWith('HEAD '))?.slice(5) ?? '';
        return { path: wtPath, branch, head };
      });
    } catch { return []; }
  }
}
