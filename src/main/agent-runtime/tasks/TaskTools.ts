/**
 * TaskTools — 把 TaskRegistry 暴露为 5 个 AgentTool。
 *
 * 工具列表：
 *  - `task_create`：创建任务；
 *  - `task_update`：更新任务（状态 / 描述 / 依赖）；
 *  - `task_get`：读取单个任务详情；
 *  - `task_list`：列出全部任务；
 *  - `task_stop`：Stop/cancel by marking cancelled。
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
export function createTaskTools(registry: TaskRegistry): AgentTool[] {
  return [
    createTaskCreateTool(registry) as unknown as AgentTool,
    createTaskUpdateTool(registry) as unknown as AgentTool,
    createTaskGetTool(registry) as unknown as AgentTool,
    createTaskListTool(registry) as unknown as AgentTool,
    createTaskStopTool(registry) as unknown as AgentTool,
  ];
}

// ── task_create ───────────────────────────────────────────────

interface TaskCreateParams {
  subject: string;
  description?: string;
  activeForm?: string;
  blockedBy?: string[];
}

/** 构造 `task_create` 工具。 */
export function createTaskCreateTool(
  registry: TaskRegistry,
): AgentTool<TaskCreateParams, { id: string }> {
  return {
    name: 'task_create',
    label: 'Create Task',
    description: 'Create a new task for tracking work progress',
    parameters: {
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
        activeForm: {
          type: 'string',
          description: 'Present continuous form for spinner',
        },
        blockedBy: {
          type: 'array',
          items: { type: 'string' },
          description: 'Task IDs that block this',
        },
      },
      required: ['subject'],
    },
    permissionHint: 'readonly',

    async execute(_toolCallId, params, signal) {
      throwIfAborted(signal);
      const subject = readString(params, 'subject', true);
      const description = readString(params, 'description', false);
      const activeForm = readString(params, 'activeForm', false);
      const blockedBy = readStringArray(params, 'blockedBy');

      const task = await registry.createTask(subject, {
        description,
        activeForm,
        blockedBy,
      });

      const depsText =
        blockedBy && blockedBy.length > 0
          ? ` (blockedBy: ${blockedBy.join(', ')})`
          : '';
      const text = `Created ${task.id}: ${task.subject}${depsText}`;

      return {
        content: [{ type: 'text', text }],
        details: { id: task.id },
      } satisfies AgentToolResult<{ id: string }>;
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
  activeForm?: string;
  owner?: string;
  addBlockedBy?: string[];
  addBlocks?: string[];
  metadata?: Record<string, unknown>;
}

interface TaskUpdateDetails {
  id: string;
  status: TaskStatus;
  unblocked: string[];
}

/** 构造 `task_update` 工具。 */
export function createTaskUpdateTool(
  registry: TaskRegistry,
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
        activeForm: { type: 'string' },
        owner: { type: 'string' },
        addBlockedBy: { type: 'array', items: { type: 'string' } },
        addBlocks: { type: 'array', items: { type: 'string' } },
        metadata: { type: 'object' },
      },
      required: ['taskId'],
    },
    permissionHint: 'readonly',

    async execute(_toolCallId, params, signal) {
      throwIfAborted(signal);
      const taskId = readString(params, 'taskId', true);

      const status = readEnum(params, 'status', ALLOWED_STATUS);
      const statusReason = readString(params, 'statusReason', false);
      const subject = readString(params, 'subject', false);
      const description = readString(params, 'description', false);
      const activeForm = readString(params, 'activeForm', false);
      const owner = readString(params, 'owner', false);
      const addBlockedBy = readStringArray(params, 'addBlockedBy');
      const addBlocks = readStringArray(params, 'addBlocks');
      const metadata =
        params.metadata && typeof params.metadata === 'object'
          ? (params.metadata as Record<string, unknown>)
          : undefined;

      const updated = await registry.updateTask(taskId, {
        status,
        statusReason,
        subject,
        description,
        activeForm,
        owner,
        addBlockedBy,
        addBlocks,
        metadata,
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

    async execute(_toolCallId, params, signal) {
      throwIfAborted(signal);
      const taskId = readString(params, 'taskId', true);
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

    async execute(_toolCallId, _params, signal) {
      throwIfAborted(signal);
      const tasks = await registry.listTasks();
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

/** 构造 `task_stop` 工具 — Stop/cancel by marking cancelled。 */
export function createTaskStopTool(
  registry: TaskRegistry,
): AgentTool<TaskStopParams, { id: string }> {
  return {
    name: 'task_stop',
    label: 'Stop Task',
    description: 'Stop/cancel by marking cancelled',
    parameters: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'ID of the task to stop' },
      },
      required: ['taskId'],
    },
    permissionHint: 'readonly',

    async execute(_toolCallId, params, signal) {
      throwIfAborted(signal);
      const taskId = readString(params, 'taskId', true);
      const task = await registry.getTask(taskId);
      if (!task) {
        return {
          content: [{ type: 'text', text: `Task not found: ${taskId}` }],
          details: { id: taskId },
        } satisfies AgentToolResult<{ id: string }>;
      }
      await registry.updateTask(taskId, { status: 'cancelled' });
      return {
        content: [{ type: 'text', text: `Stopped ${taskId}: ${task.subject}` }],
        details: { id: taskId },
      } satisfies AgentToolResult<{ id: string }>;
    },
  };
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
