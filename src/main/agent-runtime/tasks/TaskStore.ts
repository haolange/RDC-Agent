/**
 * TaskStore — 任务存储抽象。
 *
 * 把 TaskRegistry 的存储层（文件 IO）抽象为接口，使顶层 agent 用 FileTaskStore（落盘），
 * subagent 用 MemoryTaskStore（内存，随子 context 结束回收）。
 *
 * TaskRegistry 持有 TaskStore，依赖图维护等业务逻辑留在 TaskRegistry。
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import type { TaskRecord } from './TaskRegistry';

/** 任务存储接口。 */
export interface TaskStore {
  /** 读取单个任务；缺失返回 null。 */
  loadTask(taskId: string): Promise<TaskRecord | null>;
  /** 写入（创建或覆盖）任务。 */
  saveTask(task: TaskRecord): Promise<void>;
  /** 列出全部任务。 */
  listTasks(): Promise<TaskRecord[]>;
  /** 物理删除任务文件/记录。 */
  deleteTask(taskId: string): Promise<void>;
}

/** 文件持久化存储（顶层 agent 用）。 */
export class FileTaskStore implements TaskStore {
  private readonly tasksDir: string;
  private dirEnsured = false;

  constructor(tasksDir: string) {
    this.tasksDir = path.resolve(tasksDir);
  }

  private taskPath(taskId: string): string {
    return path.join(this.tasksDir, `${taskId}.json`);
  }

  private async ensureDir(): Promise<void> {
    if (this.dirEnsured) return;
    await fs.mkdir(this.tasksDir, { recursive: true });
    this.dirEnsured = true;
  }

  async loadTask(taskId: string): Promise<TaskRecord | null> {
    try {
      const raw = await fs.readFile(this.taskPath(taskId), 'utf8');
      const parsed = JSON.parse(raw) as Partial<TaskRecord>;
      return normalizeTaskRecord(parsed);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      return null;
    }
  }

  async saveTask(task: TaskRecord): Promise<void> {
    await this.ensureDir();
    // 单文件覆盖写；同进程内按 await 串行化同一 taskId 的调用即可，不做跨进程锁。
    await fs.writeFile(this.taskPath(task.id), JSON.stringify(task, null, 2), 'utf8');
  }

  async listTasks(): Promise<TaskRecord[]> {
    await this.ensureDir();
    let entries: string[];
    try {
      entries = await fs.readdir(this.tasksDir);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }
    const files = entries
      .filter((name) => name.startsWith('task_') && name.endsWith('.json'))
      .sort();
    const tasks: TaskRecord[] = [];
    for (const file of files) {
      const id = file.slice(0, -'.json'.length);
      const task = await this.loadTask(id);
      if (task) tasks.push(task);
    }
    return tasks;
  }

  async deleteTask(taskId: string): Promise<void> {
    try {
      await fs.unlink(this.taskPath(taskId));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  }
}

/** 内存存储（subagent 用，随子 context 结束回收）。 */
export class MemoryTaskStore implements TaskStore {
  private readonly store = new Map<string, TaskRecord>();

  async loadTask(taskId: string): Promise<TaskRecord | null> {
    return this.store.get(taskId) ?? null;
  }

  async saveTask(task: TaskRecord): Promise<void> {
    this.store.set(task.id, { ...task });
  }

  async listTasks(): Promise<TaskRecord[]> {
    return Array.from(this.store.values()).map((t) => ({ ...t }));
  }

  async deleteTask(taskId: string): Promise<void> {
    this.store.delete(taskId);
  }
}

/** 规范化任务记录（容忍部分字段缺失）。 */
function normalizeTaskRecord(parsed: Partial<TaskRecord>): TaskRecord | null {
  if (!parsed || typeof parsed.id !== 'string' || typeof parsed.subject !== 'string') {
    return null;
  }
  return {
    id: parsed.id,
    subject: parsed.subject,
    description: typeof parsed.description === 'string' ? parsed.description : '',
    status: (parsed.status === 'in_progress' || parsed.status === 'completed' || parsed.status === 'deleted'
      ? parsed.status
      : 'pending'),
    owner: typeof parsed.owner === 'string' ? parsed.owner : undefined,
    blockedBy: Array.isArray(parsed.blockedBy) ? parsed.blockedBy.filter((x): x is string => typeof x === 'string') : [],
    blocks: Array.isArray(parsed.blocks) ? parsed.blocks.filter((x): x is string => typeof x === 'string') : [],
    activeForm: typeof parsed.activeForm === 'string' ? parsed.activeForm : undefined,
    metadata: parsed.metadata && typeof parsed.metadata === 'object' ? parsed.metadata as Record<string, unknown> : undefined,
    createdAt: typeof parsed.createdAt === 'number' ? parsed.createdAt : Date.now(),
    updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : Date.now(),
  };
}
