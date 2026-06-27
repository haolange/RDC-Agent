/**
 * TaskRegistry — 文件持久化的任务注册表。
 *
 * 负责：
 *  - 任务的 CRUD：创建 / 读取 / 更新 / 列表；
 *  - 依赖图维护：blockedBy ↔ blocks 双向关系一致性；
 *  - 文件持久化：每个任务一个 JSON 文件，存放于 `tasksDir`；
 *  - 解锁查询：当某个任务完成后，查找因此被解锁的下游任务。
 *
 * 文件布局：`{tasksDir}/{id}.json`，默认 `tasksDir` 为 workspace 根下的 `.tasks/`。
 *
 * 注意：
 *  - 本类只描述任务存储与依赖关系，不绑定 LLM/Agent 调度；
 *  - 所有 IO 均通过 `fs/promises` 进行；
 *  - 任务 ID 采用 `task_{Date.now()}_{6-hex}` 形式，足够区分单进程内的并发创建。
 */

import * as crypto from 'crypto';
import { FileTaskStore, type TaskStore } from './TaskStore';

/** 任务状态。 */
export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'deleted';

/** 任务记录。 */
export interface TaskRecord {
  /** 任务 ID（`task_{timestamp}_{random_hex}`）。 */
  id: string;
  /** 任务标题（动作型，例如 "实现登录接口"）。 */
  subject: string;
  /** 详细描述。 */
  description: string;
  /** 当前状态。 */
  status: TaskStatus;
  /** 所有者名称（多代理协作时使用）。 */
  owner?: string;
  /** 阻塞当前任务的上游任务 ID 列表。 */
  blockedBy: string[];
  /** 被当前任务阻塞的下游任务 ID 列表。 */
  blocks: string[];
  /** 进行中（in_progress）时展示的描述（动名词形式）。 */
  activeForm?: string;
  /** 自定义元数据。 */
  metadata?: Record<string, unknown>;
  /** 创建时间戳（毫秒）。 */
  createdAt: number;
  /** 最近一次更新时间戳（毫秒）。 */
  updatedAt: number;
}

/** 创建任务时的可选参数。 */
export interface CreateTaskOptions {
  /** 详细描述。 */
  description?: string;
  /** 上游依赖任务 ID 列表。 */
  blockedBy?: string[];
  /** 所有者名称。 */
  owner?: string;
  /** 进行中描述。 */
  activeForm?: string;
  /** 自定义元数据。 */
  metadata?: Record<string, unknown>;
}

/** 更新任务时的可选参数。 */
export interface UpdateTaskOptions {
  /** 新状态。 */
  status?: TaskStatus;
  /** 新标题。 */
  subject?: string;
  /** 新描述。 */
  description?: string;
  /** 新进行中描述。 */
  activeForm?: string;
  /** 新所有者。 */
  owner?: string;
  /** 增量追加的上游依赖（不覆盖已有）。 */
  addBlockedBy?: string[];
  /** 增量追加的下游被阻塞任务（不覆盖已有）。 */
  addBlocks?: string[];
  /** 元数据补丁（浅合并）。 */
  metadata?: Record<string, unknown>;
}

/** 任务注册表。 */
export class TaskRegistry {
  /** 存储后端（FileTaskStore 落盘 / MemoryTaskStore 内存）。 */
  private readonly store: TaskStore;
  /** 任务变更回调（create/update 后触发，用于 emit task.created/updated 事件）。 */
  onTaskChange?: (event: { type: 'created' | 'updated'; task: TaskRecord }) => void;

  /**
   * 构造一个任务注册表。
   *
   * @param storeOrDir TaskStore 实例，或任务文件目录（兼容旧签名，内部建 FileTaskStore）。
   */
  constructor(storeOrDir: TaskStore | string = '.tasks') {
    this.store = typeof storeOrDir === 'string'
      ? new FileTaskStore(storeOrDir)
      : storeOrDir;
  }

  // ── 公共接口 ──────────────────────────────────────────────

  /**
   * 创建一个新任务。
   *
   * - 自动生成唯一 ID；
   * - 若指定了 `blockedBy`，会在那些上游任务的 `blocks` 列表中追加当前 ID；
   *   找不到的上游 ID 会被忽略（保留在 `blockedBy` 中，由 `canStart` 视作未完成）。
   *
   * @param subject 任务标题（动作型）。
   * @param options 可选参数。
   * @returns 新创建的任务记录。
   */
  async createTask(
    subject: string,
    options: CreateTaskOptions = {},
  ): Promise<TaskRecord> {
    if (typeof subject !== 'string' || subject.trim().length === 0) {
      throw new Error('subject 不能为空');
    }

    const now = Date.now();
    const id = this.generateId();
    const blockedBy = dedupe(options.blockedBy ?? []);

    const task: TaskRecord = {
      id,
      subject: subject.trim(),
      description: options.description ?? '',
      status: 'pending',
      owner: options.owner,
      blockedBy,
      blocks: [],
      activeForm: options.activeForm,
      metadata: options.metadata ? { ...options.metadata } : undefined,
      createdAt: now,
      updatedAt: now,
    };

    await this.saveTask(task);

    // 同步上游任务的 blocks 反向链接。
    for (const upstreamId of blockedBy) {
      await this.linkBlocks(upstreamId, id);
    }

    this.onTaskChange?.({ type: 'created', task });
    return task;
  }

  /**
   * 更新现有任务。
   *
   * - 简单字段（status / subject / description / activeForm / owner）直接覆盖；
   * - `addBlockedBy` / `addBlocks` 为增量追加（自动去重，且会同步另一端的反向链接）；
   * - `metadata` 为浅合并（传入 `null` 不会删除已有 key，请显式传入新对象）；
   * - 任何更新都会刷新 `updatedAt`。
   *
   * 当 `status` 被切换为 `completed` 时，调用方可通过 {@link getUnblockedTasks}
   * 查询哪些下游任务因此被解锁。
   *
   * @param taskId 任务 ID。
   * @param updates 更新字段。
   * @returns 更新后的任务记录。
   * @throws 如果任务不存在。
   */
  async updateTask(
    taskId: string,
    updates: UpdateTaskOptions,
  ): Promise<TaskRecord> {
    const task = await this.loadTask(taskId);
    if (!task) {
      throw new Error(`任务不存在：${taskId}`);
    }

    if (updates.status !== undefined) task.status = updates.status;
    if (updates.subject !== undefined) task.subject = updates.subject;
    if (updates.description !== undefined) {
      task.description = updates.description;
    }
    if (updates.activeForm !== undefined) task.activeForm = updates.activeForm;
    if (updates.owner !== undefined) task.owner = updates.owner;

    if (updates.metadata !== undefined) {
      task.metadata = { ...(task.metadata ?? {}), ...updates.metadata };
    }

    if (updates.addBlockedBy && updates.addBlockedBy.length > 0) {
      const added = appendUnique(task.blockedBy, updates.addBlockedBy);
      for (const upstreamId of added) {
        await this.linkBlocks(upstreamId, task.id);
      }
    }

    if (updates.addBlocks && updates.addBlocks.length > 0) {
      const added = appendUnique(task.blocks, updates.addBlocks);
      for (const downstreamId of added) {
        await this.linkBlockedBy(downstreamId, task.id);
      }
    }

    task.updatedAt = Date.now();
    await this.saveTask(task);
    this.onTaskChange?.({ type: 'updated', task });
    return task;
  }

  /**
   * 读取单个任务。
   *
   * @param taskId 任务 ID。
   * @returns 任务记录；不存在时返回 `null`。
   */
  async getTask(taskId: string): Promise<TaskRecord | null> {
    return this.loadTask(taskId);
  }

  /**
   * 列出所有任务（按 ID 升序）。
   */
  async listTasks(): Promise<TaskRecord[]> {
    return this.store.listTasks();
  }

  /**
   * 物理删除任务（不同于 updateTask status='deleted' 的软删除）。
   * 主要用于 subagent 结束后清理内存 task。
   */
  async deleteTask(taskId: string): Promise<void> {
    await this.store.deleteTask(taskId);
  }

  /**
   * 判断任务是否可以开始。
   *
   * - 所有 `blockedBy` 中的上游任务必须存在且状态为 `completed`；
   * - 上游缺失（文件不存在）视为未完成 → 仍处于阻塞状态。
   *
   * @param taskId 任务 ID。
   * @returns 任务存在且可启动时返回 `true`。
   */
  async canStart(taskId: string): Promise<boolean> {
    const task = await this.loadTask(taskId);
    if (!task) return false;
    for (const depId of task.blockedBy) {
      const dep = await this.loadTask(depId);
      if (!dep || dep.status !== 'completed') return false;
    }
    return true;
  }

  /**
   * 查找因 `completedTaskId` 完成而被解锁的下游任务。
   *
   * 解锁条件：
   *  - 下游任务状态为 `pending`；
   *  - 下游任务的 `blockedBy` 包含 `completedTaskId`；
   *  - 下游任务的所有 `blockedBy` 此刻都已完成（即 `canStart` 为真）。
   *
   * @param completedTaskId 刚完成的任务 ID。
   * @returns 被解锁的下游任务记录列表（可能为空）。
   */
  async getUnblockedTasks(completedTaskId: string): Promise<TaskRecord[]> {
    const all = await this.listTasks();
    const unblocked: TaskRecord[] = [];
    for (const task of all) {
      if (task.status !== 'pending') continue;
      if (!task.blockedBy.includes(completedTaskId)) continue;
      if (await this.canStart(task.id)) {
        unblocked.push(task);
      }
    }
    return unblocked;
  }

  // ── 私有辅助 ──────────────────────────────────────────────

  /** 生成任务 ID。 */
  private generateId(): string {
    return `task_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
  }

  /** 把任务写入存储（委托 TaskStore）。 */
  private async saveTask(task: TaskRecord): Promise<void> {
    await this.store.saveTask(task);
  }

  /** 从存储读取任务；缺失返回 `null`（委托 TaskStore）。 */
  private async loadTask(taskId: string): Promise<TaskRecord | null> {
    return this.store.loadTask(taskId);
  }

  /** 在上游任务的 `blocks` 中追加 `downstreamId`（若上游存在）。 */
  private async linkBlocks(
    upstreamId: string,
    downstreamId: string,
  ): Promise<void> {
    const upstream = await this.loadTask(upstreamId);
    if (!upstream) return;
    if (upstream.blocks.includes(downstreamId)) return;
    upstream.blocks = [...upstream.blocks, downstreamId];
    upstream.updatedAt = Date.now();
    await this.saveTask(upstream);
  }

  /** 在下游任务的 `blockedBy` 中追加 `upstreamId`（若下游存在）。 */
  private async linkBlockedBy(
    downstreamId: string,
    upstreamId: string,
  ): Promise<void> {
    const downstream = await this.loadTask(downstreamId);
    if (!downstream) return;
    if (downstream.blockedBy.includes(upstreamId)) return;
    downstream.blockedBy = [...downstream.blockedBy, upstreamId];
    downstream.updatedAt = Date.now();
    await this.saveTask(downstream);
  }
}

// ── 模块级工具函数 ────────────────────────────────────────────

/** 数组去重（保留首次出现顺序）。 */
function dedupe(arr: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of arr) {
    if (typeof item !== 'string' || item.length === 0) continue;
    if (seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}

/**
 * 将 `incoming` 中尚未出现在 `target` 中的元素追加到 `target`，原地修改。
 *
 * @returns 实际新增的元素列表（可用于触发副作用）。
 */
function appendUnique(target: string[], incoming: readonly string[]): string[] {
  const existing = new Set(target);
  const added: string[] = [];
  for (const item of incoming) {
    if (typeof item !== 'string' || item.length === 0) continue;
    if (existing.has(item)) continue;
    existing.add(item);
    target.push(item);
    added.push(item);
  }
  return added;
}

/** 把磁盘读取的对象规整为 `TaskRecord`，对缺省字段填默认值。 */
// normalizeTask 已移至 TaskStore（FileTaskStore.normalizeTaskRecord），
// TaskRegistry 的 loadTask 现委托 store，不再直接规整。

