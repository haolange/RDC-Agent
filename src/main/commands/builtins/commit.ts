/**
 * /commit — 自动生成 git commit 信息并提交。
 */
import { execSync } from 'child_process';
import type { CommandDefinition } from '@shared/types/command';

export const commitCommand: CommandDefinition = {
  id: 'commit',
  name: 'commit',
  description: 'Auto-generate commit message and commit staged changes',
  category: 'workflow',

  async execute(args) {
    try {
      const status = execSync('git status --short', { encoding: 'utf8' });
      if (!status.trim()) {
        return { success: true, message: 'Nothing to commit. Working tree clean.' };
      }
      const diff = execSync('git diff --cached --stat', { encoding: 'utf8' });
      const msg = args.length > 0 ? args.join(' ') : `chore: update\n\n${diff.slice(0, 500)}`;
      execSync(`git commit -m "${msg.replace(/"/g, '\\"')}"`, { encoding: 'utf8' });
      return { success: true, message: `Committed:\n${msg.slice(0, 300)}` };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, message: `Commit failed: ${message}` };
    }
  },
};

/**
 * /diff — 查看未提交变更。
 */
export const diffCommand: CommandDefinition = {
  id: 'diff',
  name: 'diff',
  description: 'Show unstaged git diff',
  category: 'workflow',

  async execute(args) {
    try {
      const staged = args.includes('--staged') ? ' --cached' : '';
      const diff = execSync(`git diff${staged} --stat`, { encoding: 'utf8', maxBuffer: 1024 * 1024 });
      return { success: true, message: diff || 'No changes.' };
    } catch (err) {
      return { success: false, message: `Diff failed: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
};

/**
 * /review — 代码审查（调用 agent 审查当前 diff）。
 */
export const reviewCommand: CommandDefinition = {
  id: 'review',
  name: 'review',
  description: 'Review current changes for bugs and improvements',
  category: 'workflow',

  async execute() {
    return {
      success: true,
      message: 'Starting code review of current changes...',
      sideEffect: 'trigger-code-review',
    };
  },
};
