/**
 * TaskTools - 子任务管理工具
 * 提供 task.create、task.update、task.list 三个系统工具
 */

import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';

// 任务状态类型
export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled';

// 子任务接口
export interface SubTask {
  id: string;
  title: string;
  description: string;
  assignee?: string;
  status: TaskStatus;
  result?: string;
  createdAt: string;
  updatedAt: string;
  parentTaskId?: string;
}

// 内存存储
const taskStore = new Map<string, SubTask>();

interface TaskCreateInput {
  title: string;
  description: string;
  assignee?: string;
  parentTaskId?: string;
}

interface TaskUpdateInput {
  taskId: string;
  status: TaskStatus;
  result?: string;
}

interface TaskListInput {
  filter?: TaskStatus | 'all';
  parentTaskId?: string;
  limit?: number;
}


/**
 * 生成任务 ID
 */
function generateTaskId(): string {
  return `task_${uuidv4().replace(/-/g, '').substring(0, 12)}`;
}

/**
 * 获取当前时间 ISO 字符串
 */
function now(): string {
  return new Date().toISOString();
}

/**
 * 创建 Task 工具
 */
export function createTaskTools(): DynamicStructuredTool[] {
  return [
    // task.create - 创建子任务
    new DynamicStructuredTool({
      name: 'task_create',
      description: 'Create a new sub-task. Returns the created task with its ID.',
      schema: z.object({
        title: z.string().min(1).max(200).describe('Task title'),
        description: z.string().min(1).max(2000).describe('Task description'),
        assignee: z.string().optional().describe('Optional assignee identifier'),
        parentTaskId: z.string().optional().describe('Optional parent task ID'),
      }),
      func: async ({ title, description, assignee, parentTaskId }: TaskCreateInput) => {
        try {
          // 验证父任务是否存在
          if (parentTaskId && !taskStore.has(parentTaskId)) {
            return JSON.stringify({
              ok: false,
              error: { 
                code: 'PARENT_NOT_FOUND', 
                message: `Parent task not found: ${parentTaskId}` 
              }
            });
          }
          
          const taskId = generateTaskId();
          const task: SubTask = {
            id: taskId,
            title,
            description,
            assignee,
            status: 'pending',
            createdAt: now(),
            updatedAt: now(),
            parentTaskId
          };
          
          taskStore.set(taskId, task);
          
          return JSON.stringify({
            ok: true,
            data: {
              task: {
                id: taskId,
                title,
                description,
                assignee,
                status: 'pending',
                parentTaskId,
                createdAt: task.createdAt
              }
            }
          });
        } catch (error) {
          return JSON.stringify({
            ok: false,
            error: { 
              code: 'CREATE_ERROR', 
              message: error instanceof Error ? error.message : 'Unknown error' 
            }
          });
        }
      },
      metadata: { layer: 'system', originalName: 'task.create' }
    }),

    // task.update - 更新子任务状态
    new DynamicStructuredTool({
      name: 'task_update',
      description: 'Update a task status and optionally set result. Returns the updated task.',
      schema: z.object({
        taskId: z.string().describe('Task ID to update'),
        status: z.enum(['pending', 'in_progress', 'completed', 'failed', 'cancelled']).describe('New status'),
        result: z.string().optional().describe('Optional result/description'),
      }),
      func: async ({ taskId, status, result }: TaskUpdateInput) => {
        try {
          const task = taskStore.get(taskId);
          
          if (!task) {
            return JSON.stringify({
              ok: false,
              error: { 
                code: 'TASK_NOT_FOUND', 
                message: `Task not found: ${taskId}` 
              }
            });
          }
          
          // 更新任务
          task.status = status;
          task.updatedAt = now();
          
          if (result !== undefined) {
            task.result = result;
          }
          
          taskStore.set(taskId, task);
          
          return JSON.stringify({
            ok: true,
            data: {
              task: {
                id: task.id,
                title: task.title,
                status: task.status,
                result: task.result,
                updatedAt: task.updatedAt
              }
            }
          });
        } catch (error) {
          return JSON.stringify({
            ok: false,
            error: { 
              code: 'UPDATE_ERROR', 
              message: error instanceof Error ? error.message : 'Unknown error' 
            }
          });
        }
      },
      metadata: { layer: 'system', originalName: 'task.update' }
    }),

    // task.list - 列出子任务
    new DynamicStructuredTool({
      name: 'task_list',
      description: 'List tasks with optional filtering. Returns list of tasks.',
      schema: z.object({
        filter: z.enum(['all', 'pending', 'in_progress', 'completed', 'failed', 'cancelled']).optional().default('all').describe('Filter by status'),
        parentTaskId: z.string().optional().describe('Filter by parent task ID'),
        limit: z.number().int().min(1).max(100).optional().default(50).describe('Maximum number of results'),
      }),
      func: async ({ filter = 'all', parentTaskId, limit = 50 }: TaskListInput) => {
        try {
          let tasks = Array.from(taskStore.values());
          
          // 按状态过滤
          if (filter !== 'all') {
            tasks = tasks.filter(t => t.status === filter);
          }
          
          // 按父任务过滤
          if (parentTaskId !== undefined) {
            tasks = tasks.filter(t => t.parentTaskId === parentTaskId);
          }
          
          // 按更新时间排序（最新的在前）
          tasks.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
          
          // 限制数量
          const total = tasks.length;
          tasks = tasks.slice(0, limit);
          
          return JSON.stringify({
            ok: true,
            data: {
              tasks: tasks.map(t => ({
                id: t.id,
                title: t.title,
                status: t.status,
                assignee: t.assignee,
                parentTaskId: t.parentTaskId,
                createdAt: t.createdAt,
                updatedAt: t.updatedAt
              })),
              total,
              returned: tasks.length,
              filter,
              limit
            }
          });
        } catch (error) {
          return JSON.stringify({
            ok: false,
            error: { 
              code: 'LIST_ERROR', 
              message: error instanceof Error ? error.message : 'Unknown error' 
            }
          });
        }
      },
      metadata: { layer: 'system', originalName: 'task.list' }
    }),
  ];
}

/**
 * 获取任务存储（用于外部访问，如 StorageAdapter 集成）
 */
export function getTaskStore(): Map<string, SubTask> {
  return taskStore;
}

/**
 * 清空所有任务（用于测试）
 */
export function clearAllTasks(): void {
  taskStore.clear();
}

/**
 * 获取单个任务
 */
export function getTask(taskId: string): SubTask | undefined {
  return taskStore.get(taskId);
}
