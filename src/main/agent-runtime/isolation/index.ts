/**
 * Worktree 隔离层统一导出。
 *
 * 提供基于 `git worktree` 的目录隔离能力，
 * 供 SubagentSpawner 在创建子 Agent 时按需绑定。
 */
export {
  WorktreeManager,
  GitCommandError,
  type WorktreeInfo,
  type CreateWorktreeOptions,
} from './WorktreeManager';
