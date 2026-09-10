/**
 * TaskTools — 把 TaskRegistry 暴露为 5 个 AgentTool。
 *
 * 工具列表：
 *  - `task_create`：批量创建任务；
 *  - `task_update`：更新任务（状态 / 描述 / 依赖）；
 *  - `task_get`：读取单个任务详情；
 *  - `task_list`：列出全部任务；
 *  - `task_stop`：cancel the owned execution and join it before terminalizing the Task.
 *
 * 设计要点：
 *  - 所有工具都是 `readonly` 权限提示（任务存储是 agent 自管的私有目录，
 *    不修改用户工程文件）；
 *  - 所有工具的返回值都是 `AgentToolResult`，content 全部为 `text` 类型；
 *  - 工厂函数 `createTaskTools(registry)` 接收一个共享的 `TaskRegistry` 实例，
 *    便于测试时注入临时目录。
 */

import type { AgentTool, AgentToolResult } from '../agent/AgentTool';
import {
  TaskRegistry,
  type TaskRecord,
  type TaskStatus,
} from './TaskRegistry';
import type { StartTaskExecutionOptions } from './TaskContracts';

export interface TaskToolExecutionContext {
  startOptions?: () => Omit<StartTaskExecutionOptions, 'mode'> | Promise<Omit<StartTaskExecutionOptions, 'mode'>>;
  scopeRootTaskId?: string;
  requestCurrentTurnStop?: (taskId: string) => boolean;
}

/** 允许工具更新的状态值。 */
const ALLOWED_STATUS: TaskStatus[] = [
  'pending',
  'in_progress',
  'blocked',
  'completed',
  'cancelled',
];

/**
 * 基于一个 `TaskRegistry` 实例创建 4 个工具。
 *
 * @param registry 任务注册表实例。
 * @returns 工具数组：`[task_create, task_update, task_get, task_list, task_stop]`。
 */
export function createTaskTools(registry: TaskRegistry, context: TaskToolExecutionContext = {}): AgentTool[] {
  return [
    createTaskCreateTool(registry, context) as unknown as AgentTool,
    createTaskUpdateTool(registry, context) as unknown as AgentTool,
    createTaskGetTool(registry, context) as unknown as AgentTool,
    createTaskListTool(registry, context) as unknown as AgentTool,
    createTaskStopTool(registry, context) as unknown as AgentTool,
  ];
}

// ── task_create ───────────────────────────────────────────────

interface TaskCreateItem {
  subject: string;
  description?: string;
  blockedBy?: string[];
  completionRequirements?: string[];
  parentTaskId?: string;
}

interface TaskCreateParams {
  tasks: TaskCreateItem[];
}

/** 构造 `task_create` 工具。 */
export function createTaskCreateTool(
  registry: TaskRegistry,
  context: TaskToolExecutionContext = {},
): AgentTool<TaskCreateParams, { ids: string[] }> {
  return {
    name: 'task_create',
    label: 'Create Tasks',
    description: 'Create the full task list for this turn in one call',
    parameters: {
      type: 'object',
      properties: {
        tasks: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            properties: {
              subject: {
                type: 'string',
                description: 'Brief imperative title',
              },
              description: {
                type: 'string',
                description: 'Detailed description',
              },
              blockedBy: {
                type: 'array',
                items: { type: 'string' },
                description: 'Task IDs that block this',
              },
              completionRequirements: {
                type: 'array',
                items: { type: 'string' },
                description: 'Named output keys required before completion',
              },
              parentTaskId: { type: 'string', description: 'Optional parent logical Task id.' },
            },
            required: ['subject'],
          },
          description: 'Complete list of tasks to create together',
        },
      },
      required: ['tasks'],
    },
    permissionHint: 'readonly',
    spec: { isReadOnly: false, isConcurrencySafe: false, orchestration: true, isDestructive: false, sideEffect: 'session', category: 'task', requiresApproval: false },

    async execute(_toolCallId, params, signal) {
      throwIfAborted(signal);
      const items = readTaskItems(params).map((item) => context.scopeRootTaskId && !item.parentTaskId ? { ...item, parentTaskId: context.scopeRootTaskId } : item);
      for (const item of items) {
        if (item.parentTaskId) await assertTaskInScope(registry, item.parentTaskId, context.scopeRootTaskId, true);
        for (const dependencyId of item.blockedBy ?? []) {
          await assertTaskInScope(registry, dependencyId, context.scopeRootTaskId, false);
        }
      }
      const created = await registry.createTasks(items);
      const text = created
        .map((task) => {
          const depsText = task.blockedBy.length > 0
            ? ` (blockedBy: ${task.blockedBy.join(', ')})`
            : '';
          return `Created ${task.id}: ${task.subject}${depsText}`;
        })
        .join('\n');

      return {
        content: [{ type: 'text', text }],
        details: { ids: created.map((task) => task.id) },
      } satisfies AgentToolResult<{ ids: string[] }>;
    },
  };
}

// ── task_update ───────────────────────────────────────────────

interface TaskUpdateParams {
  taskId: string;
  status?: TaskStatus;
  statusReason?: string;
  subject?: string;
  description?: string;
  owner?: string;
  addBlockedBy?: string[];
  addBlocks?: string[];
  metadata?: Record<string, unknown>;
  result?: { disposition: 'completed' | 'partial' | 'blocked' | 'cancelled'; summary: string; outputs: Record<string, string>; missingRequirements?: string[]; resultRef?: string; resultHash?: string };
}

interface TaskUpdateDetails {
  id: string;
  status: TaskStatus;
  unblocked: string[];
}

/** 构造 `task_update` 工具。 */
export function createTaskUpdateTool(
  registry: TaskRegistry,
  context: TaskToolExecutionContext = {},
): AgentTool<TaskUpdateParams, TaskUpdateDetails> {
  return {
    name: 'task_update',
    label: 'Update Task',
    description: 'Update an existing task status or details',
    parameters: {
      type: 'object',
      properties: {
        taskId: { type: 'string' },
        status: {
          type: 'string',
          enum: ['pending', 'in_progress', 'blocked', 'completed', 'cancelled'],
        },
        statusReason: { type: 'string' },
        subject: { type: 'string' },
        description: { type: 'string' },
        owner: { type: 'string' },
        addBlockedBy: { type: 'array', items: { type: 'string' } },
        addBlocks: { type: 'array', items: { type: 'string' } },
        metadata: { type: 'object' },
        result: {
          type: 'object',
          properties: {
            disposition: { type: 'string', enum: ['completed', 'partial', 'blocked', 'cancelled'] },
            summary: { type: 'string' },
            outputs: { type: 'object' },
            missingRequirements: { type: 'array', items: { type: 'string' } },
            resultRef: { type: 'string' },
            resultHash: { type: 'string' },
          },
          required: ['disposition', 'summary', 'outputs'],
        },
      },
      required: ['taskId'],
    },
    permissionHint: 'readonly',
    spec: { isReadOnly: false, isConcurrencySafe: false, orchestration: true, isDestructive: false, sideEffect: 'session', category: 'task', requiresApproval: false },

    async execute(_toolCallId, params, signal) {
      throwIfAborted(signal);
      const taskId = readString(params, 'taskId', true);
      await assertTaskInScope(registry, taskId, context.scopeRootTaskId, false);

      const status = readEnum(params, 'status', ALLOWED_STATUS);
      const statusReason = readString(params, 'statusReason', false);
      const subject = readString(params, 'subject', false);
      const description = readString(params, 'description', false);
      const owner = readString(params, 'owner', false);
      const addBlockedBy = readStringArray(params, 'addBlockedBy');
      const addBlocks = readStringArray(params, 'addBlocks');
      // Both relation operations update the reciprocal record. A delegated
      // agent must not use either edge to modify a task outside its subtree.
      for (const linkedTaskId of [...(addBlockedBy ?? []), ...(addBlocks ?? [])]) {
        await assertTaskInScope(registry, linkedTaskId, context.scopeRootTaskId, false);
      }
      const metadata =
        params.metadata && typeof params.metadata === 'object'
          ? (params.metadata as Record<string, unknown>)
          : undefined;

      const result = readCompletionResult(params.result);
      const hasSemanticUpdates = subject !== undefined || description !== undefined || owner !== undefined
        || Boolean(addBlockedBy?.length) || Boolean(addBlocks?.length) || metadata !== undefined;
      if (status && hasSemanticUpdates) throw new Error('Status transitions cannot be combined with task definition updates.');
      let updated: TaskRecord;
      if (status === 'in_progress') {
        const startOptions = await context.startOptions?.();
        await registry.startExecution(taskId, { mode: 'direct', ...startOptions });
        updated = (await registry.getTask(taskId))!;
      } else if (status === 'cancelled') {
        if (context.requestCurrentTurnStop?.(taskId)) {
          updated = (await registry.getTask(taskId))!;
        } else {
          updated = await registry.cancelTask(taskId, statusReason ?? 'Cancelled by task owner.');
        }
      } else if (status === 'completed' || status === 'blocked') {
        const task = await registry.getTask(taskId);
        if (!task?.currentExecutionId) throw new Error('Task must be started before it can be settled.');
        const execution = await registry.getExecution(task.currentExecutionId);
        if (!execution) throw new Error('Current task execution is missing.');
        if (execution.mode !== 'direct') throw new Error('Managed subagent and handoff executions are settled by their execution owner.');
        const disposition = status === 'completed' ? 'completed' : status;
        const effective = result ?? { disposition, summary: statusReason ?? `Task ${status}.`, outputs: {} };
        const executionStatus = effective.disposition === 'partial' ? 'partial' : status === 'completed' ? 'completed' : status === 'blocked' ? 'blocked' : 'cancelled';
        await registry.settleExecution(execution.id, { status: executionStatus, result: effective, expectedGeneration: execution.generation });
        updated = (await registry.getTask(taskId))!;
      } else updated = await registry.updateTask(taskId, {
        status,
        statusReason,
        subject,
        description,
        owner,
        addBlockedBy,
        addBlocks,
        metadata,
        result,
      });

      let unblocked: TaskRecord[] = [];
      if (status === 'completed') {
        unblocked = await registry.getUnblockedTasks(updated.id);
      }

      const lines: string[] = [
        `Updated ${updated.id}: ${updated.subject} [${updated.status}]`,
      ];
      if (unblocked.length > 0) {
        lines.push(
          `Unblocked: ${unblocked.map((t) => `${t.id} (${t.subject})`).join(', ')}`,
        );
      }

      return {
        content: [{ type: 'text', text: lines.join('\n') }],
        details: {
          id: updated.id,
          status: updated.status,
          unblocked: unblocked.map((t) => t.id),
        },
      } satisfies AgentToolResult<TaskUpdateDetails>;
    },
  };
}

// ── task_get ──────────────────────────────────────────────────

interface TaskGetParams {
  taskId: string;
}

/** 构造 `task_get` 工具。 */
export function createTaskGetTool(
  registry: TaskRegistry,
  context: TaskToolExecutionContext = {},
): AgentTool<TaskGetParams, { id: string; found: boolean }> {
  return {
    name: 'task_get',
    label: 'Get Task',
    description: 'Get full details of a specific task',
    pollable: true,
    parameters: {
      type: 'object',
      properties: {
        taskId: { type: 'string' },
      },
      required: ['taskId'],
    },
    permissionHint: 'readonly',
    spec: { isReadOnly: true, isConcurrencySafe: true, isDestructive: false, sideEffect: 'none', category: 'task', requiresApproval: false },

    async execute(_toolCallId, params, signal) {
      throwIfAborted(signal);
      const taskId = readString(params, 'taskId', true);
      await assertTaskInScope(registry, taskId, context.scopeRootTaskId, false);
      const task = await registry.getTask(taskId);
      if (!task) {
        return {
          content: [{ type: 'text', text: `Task not found: ${taskId}` }],
          details: { id: taskId, found: false },
        } satisfies AgentToolResult<{ id: string; found: boolean }>;
      }
      return {
        content: [{ type: 'text', text: JSON.stringify(task, null, 2) }],
        details: { id: task.id, found: true },
      } satisfies AgentToolResult<{ id: string; found: boolean }>;
    },
  };
}

// ── task_list ─────────────────────────────────────────────────

/** 构造 `task_list` 工具。 */
export function createTaskListTool(
  registry: TaskRegistry,
  context: TaskToolExecutionContext = {},
): AgentTool<Record<string, never>, { count: number }> {
  return {
    name: 'task_list',
    label: 'List Tasks',
    description: 'List all tasks with their current status',
    pollable: true,
    parameters: {
      type: 'object',
      properties: {},
    },
    permissionHint: 'readonly',
    spec: { isReadOnly: true, isConcurrencySafe: true, isDestructive: false, sideEffect: 'none', category: 'task', requiresApproval: false },

    async execute(_toolCallId, _params, signal) {
      throwIfAborted(signal);
      const allTasks = await registry.listTasks();
      const tasks = context.scopeRootTaskId ? allTasks.filter((task) => isTaskInScope(task.id, context.scopeRootTaskId!, allTasks, false)) : allTasks;
      if (tasks.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: 'No tasks. Use task_create to add some.',
            },
          ],
          details: { count: 0 },
        } satisfies AgentToolResult<{ count: number }>;
      }
      const lines = tasks.map(formatTaskLine);
      return {
        content: [{ type: 'text', text: lines.join('\n') }],
        details: { count: tasks.length },
      } satisfies AgentToolResult<{ count: number }>;
    },
  };
}

// ── task_stop ──────────────────────────────────────────────────

interface TaskStopParams {
  taskId: string;
}

/** Construct task_stop: cancel and join its execution tree before terminalizing. */
export function createTaskStopTool(
  registry: TaskRegistry,
  context: TaskToolExecutionContext = {},
): AgentTool<TaskStopParams, { id: string }> {
  return {
    name: 'task_stop',
    label: 'Stop Task',
    description: 'Cancel a Task execution tree, wait for managed producers to stop, then record the terminal state.',
    parameters: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'ID of the task to stop' },
      },
      required: ['taskId'],
    },
    permissionHint: 'readonly',
    spec: { isReadOnly: false, isConcurrencySafe: false, orchestration: true, isDestructive: false, sideEffect: 'session', category: 'task', requiresApproval: false },

    async execute(_toolCallId, params, signal) {
      throwIfAborted(signal);
      const taskId = readString(params, 'taskId', true);
      await assertTaskInScope(registry, taskId, context.scopeRootTaskId, false);
      const task = await registry.getTask(taskId);
      if (!task) {
        return {
          content: [{ type: 'text', text: `Task not found: ${taskId}` }],
          details: { id: taskId },
        } satisfies AgentToolResult<{ id: string }>;
      }
      if (context.requestCurrentTurnStop?.(taskId)) {
        return {
          content: [{ type: 'text', text: `Stop requested for ${taskId}; terminal state will be recorded after its turn producers join.` }],
          details: { id: taskId },
        } satisfies AgentToolResult<{ id: string }>;
      }
      await registry.cancelTask(taskId, 'Stopped by task owner.');
      return {
        content: [{ type: 'text', text: `Stopped ${taskId}: ${task.subject}` }],
        details: { id: taskId },
      } satisfies AgentToolResult<{ id: string }>;
    },
  };
}

async function assertTaskInScope(registry: TaskRegistry, taskId: string, rootTaskId: string | undefined, allowRoot: boolean): Promise<void> {
  if (!rootTaskId) return;
  const tasks = await registry.listTasks();
  if (!isTaskInScope(taskId, rootTaskId, tasks, allowRoot)) throw new Error('TASK_SCOPE_DENIED: delegated agents may access only descendants of their owning Task.');
}

function isTaskInScope(taskId: string, rootTaskId: string, tasks: readonly TaskRecord[], allowRoot: boolean): boolean {
  if (taskId === rootTaskId) return allowRoot;
  let current = tasks.find((task) => task.id === taskId);
  while (current?.parentTaskId) {
    if (current.parentTaskId === rootTaskId) return true;
    current = tasks.find((task) => task.id === current!.parentTaskId);
  }
  return false;
}

// ── 共享辅助 ──────────────────────────────────────────────────

/** 在 abort 信号已触发时抛出错误，供 ToolRegistry 转换成错误结果。 */
function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new Error('Aborted');
  }
}

/** 从未知入参中读取字符串字段；`required` 时为空会抛错。 */
function readString(params: object, key: string, required: true): string;
// eslint-disable-next-line no-redeclare
function readString(params: object, key: string, required: false): string | undefined;
// eslint-disable-next-line no-redeclare
function readString(
  params: object,
  key: string,
  required: boolean,
): string | undefined {
  const value = (params as Record<string, unknown>)[key];
  if (value === undefined || value === null || value === '') {
    if (required) throw new Error(`参数 "${key}" 不能为空`);
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new Error(`参数 "${key}" 必须是字符串`);
  }
  return value;
}

/** 读取 task_create 的唯一批量入参。 */
function readTaskItems(params: object): TaskCreateItem[] {
  const value = (params as Record<string, unknown>).tasks;
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('参数 "tasks" 必须是非空数组');
  }
  return value.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`参数 "tasks[${index}]" 必须是对象`);
    }
    const record = item as Record<string, unknown>;
    const subject = readString(record, 'subject', true);
    return {
      subject,
      description: readString(record, 'description', false),
      blockedBy: readStringArray(record, 'blockedBy'),
      completionRequirements: readStringArray(record, 'completionRequirements'),
      parentTaskId: readString(record, 'parentTaskId', false),
    };
  });
}

function readCompletionResult(value: unknown): TaskUpdateParams['result'] {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('参数 "result" 必须是对象');
  const record = value as Record<string, unknown>;
  const disposition = readEnum(record, 'disposition', ['completed', 'partial', 'blocked', 'cancelled'] as const);
  const summary = readString(record, 'summary', true);
  if (!disposition) throw new Error('参数 "result.disposition" 不能为空');
  const outputsValue = record.outputs;
  if (!outputsValue || typeof outputsValue !== 'object' || Array.isArray(outputsValue)) throw new Error('参数 "result.outputs" 必须是对象');
  const outputs: Record<string, string> = {};
  for (const [key, item] of Object.entries(outputsValue)) { if (typeof item !== 'string') throw new Error('参数 "result.outputs" 的值必须是字符串'); outputs[key] = item; }
  return { disposition, summary, outputs, missingRequirements: readStringArray(record, 'missingRequirements'), resultRef: readString(record, 'resultRef', false), resultHash: readString(record, 'resultHash', false) };
}

/** 从未知入参中读取字符串数组字段。 */
function readStringArray(
  params: object,
  key: string,
): string[] | undefined {
  const value = (params as Record<string, unknown>)[key];
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) {
    throw new Error(`参数 "${key}" 必须是字符串数组`);
  }
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string' || item.length === 0) {
      throw new Error(`参数 "${key}" 中存在非法元素`);
    }
    out.push(item);
  }
  return out;
}

/** 读取受限的枚举字段；不在白名单内时抛错。 */
function readEnum<T extends string>(
  params: object,
  key: string,
  allowed: readonly T[],
): T | undefined {
  const value = (params as Record<string, unknown>)[key];
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new Error(
      `参数 "${key}" 必须是以下之一：${allowed.join(', ')}`,
    );
  }
  return value as T;
}

/** 任务行格式化（用于 task_list 输出）。 */
function formatTaskLine(task: TaskRecord): string {
  const icon = STATUS_ICON[task.status] ?? '?';
  const owner = task.owner ? ` [${task.owner}]` : '';
  const deps =
    task.blockedBy.length > 0
      ? ` (blockedBy: ${task.blockedBy.join(', ')})`
      : '';
  return `  ${icon} ${task.id}: ${task.subject} [${task.status}]${owner}${deps}`;
}

const STATUS_ICON: Record<TaskStatus, string> = {
  pending: '○',
  in_progress: '●',
  blocked: '!',
  completed: '✓',
  cancelled: '×',
};
