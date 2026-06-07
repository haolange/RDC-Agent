/**
 * Agent Runtime · scheduler 子模块统一导出。
 *
 * 收敛三类调度能力：
 * - BackgroundTaskRunner：后台异步任务执行器（Task 13）
 * - CronParser：纯函数版的五段式 cron 表达式解析与匹配（Task 14）
 * - CronScheduler：基于轮询的 cron 任务调度器，支持持久化（Task 14）
 */

export {
  BackgroundTaskRunner,
  getBackgroundTaskRunner,
  __setBackgroundTaskRunnerForTest,
} from './BackgroundTaskRunner';
export type {
  BackgroundTask,
  BackgroundTaskStatus,
} from './BackgroundTaskRunner';

export { parseCron, matchesCron, matchesField } from './CronParser';
export type { CronField } from './CronParser';

export { CronScheduler } from './CronScheduler';
export type { CronJob, CronSchedulerOptions } from './CronScheduler';
