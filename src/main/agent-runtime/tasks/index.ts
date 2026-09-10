/**
 * tasks 子模块统一导出。
 *
 * - `TaskRegistry`：文件持久化的任务注册表（CRUD + 依赖图）；
 * - `createTaskTools` 等：把注册表暴露为 4 个 AgentTool 的工厂；
 * - 所有相关接口与类型。
 */

export {
  TaskRegistry,
  type TaskRecord,
  type TaskStatus,
  type CreateTaskOptions,
  type UpdateTaskOptions,
} from './TaskRegistry';

export {
  TASK_SCHEMA_VERSION,
  type TaskDisposition,
  type TaskCompletionResult,
  type TaskBudgetState,
  type TaskExecutionStatus,
  type TaskExecutionRecord,
  type TaskExecutionMessage,
  type TaskMessageKind,
  type TaskRootBudgetRecord,
  type StartTaskExecutionOptions,
  type SettleTaskExecutionOptions,
} from './TaskContracts';

export {
  registerTaskExecutionCancellationOwner,
  cancelOwnedTaskExecution,
} from './TaskExecutionOwners';
export { registerDelegatedTaskScope, getDelegatedTaskScope } from './DelegatedTaskScopes';

export {
  type TaskStore,
  FileTaskStore,
  MemoryTaskStore,
} from './TaskStore';

export {
  createTaskTools,
  createTaskCreateTool,
  createTaskUpdateTool,
  createTaskGetTool,
  createTaskListTool,
  createTaskStopTool,
  type TaskToolExecutionContext,
} from './TaskTools';

export {
  resolveSessionTasksDir,
  createSessionTaskStore,
} from './sessionTaskStore';

export {
  createdAtFromTaskId,
  orderTasks,
  projectTaskItems,
  type ProjectedTaskItem,
  type ProjectedTaskStatus,
} from './taskProjection';
