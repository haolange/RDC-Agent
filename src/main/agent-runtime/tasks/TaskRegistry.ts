import * as crypto from 'crypto';
import { FileTaskStore, type TaskStore } from './TaskStore';

export type TaskStatus = 'pending' | 'in_progress' | 'blocked' | 'completed' | 'cancelled';

export interface TaskRecord {
  id: string;
  subject: string;
  description: string;
  status: TaskStatus;
  statusReason?: string;
  owner?: string;
  blockedBy: string[];
  blocks: string[];
  activeForm?: string;
  metadata?: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

export interface CreateTaskOptions {
  description?: string;
  blockedBy?: string[];
  owner?: string;
  activeForm?: string;
  metadata?: Record<string, unknown>;
}

export interface UpdateTaskOptions {
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

export class TaskRegistry {
  onTaskChange?: (event: { type: 'created' | 'updated'; task: TaskRecord }) => void;
  private readonly store: TaskStore;

  constructor(storeOrDir: TaskStore | string) {
    this.store = typeof storeOrDir === 'string' ? new FileTaskStore(storeOrDir) : storeOrDir;
  }

  async createTask(subject: string, options: CreateTaskOptions = {}): Promise<TaskRecord> {
    if (!subject.trim()) throw new Error('Task subject is required.');
    const now = Date.now();
    const id = this.generateId();
    const blockedBy = dedupe(options.blockedBy ?? []);
    await this.assertNoDependencyCycle(id, blockedBy);
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
    for (const upstreamId of blockedBy) await this.linkBlocks(upstreamId, id);
    this.onTaskChange?.({ type: 'created', task });
    return task;
  }

  async updateTask(taskId: string, updates: UpdateTaskOptions): Promise<TaskRecord> {
    const task = await this.loadTask(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);

    const nextStatus = updates.status ?? task.status;
    const nextReason = updates.statusReason
      ?? (updates.status === undefined || nextStatus === 'blocked' ? task.statusReason : undefined);
    if (nextStatus === 'blocked' && !nextReason?.trim()) {
      throw new Error('Blocked tasks require a statusReason.');
    }
    if (nextStatus === 'in_progress' && task.status !== 'in_progress') {
      await this.assertNoOtherInProgress(task.id);
    }

    task.status = nextStatus;
    task.statusReason = nextReason;
    if (updates.subject !== undefined) task.subject = updates.subject;
    if (updates.description !== undefined) task.description = updates.description;
    if (updates.activeForm !== undefined) task.activeForm = updates.activeForm;
    if (updates.owner !== undefined) task.owner = updates.owner;
    if (updates.metadata !== undefined) task.metadata = { ...(task.metadata ?? {}), ...updates.metadata };

    if (updates.addBlockedBy?.length) {
      const additions = dedupe(updates.addBlockedBy);
      await this.assertNoDependencyCycle(task.id, additions);
      for (const upstreamId of appendUnique(task.blockedBy, additions)) await this.linkBlocks(upstreamId, task.id);
    }
    if (updates.addBlocks?.length) {
      const additions = dedupe(updates.addBlocks);
      for (const downstreamId of additions) await this.assertNoDependencyCycle(downstreamId, [task.id]);
      for (const downstreamId of appendUnique(task.blocks, additions)) await this.linkBlockedBy(downstreamId, task.id);
    }

    task.updatedAt = Date.now();
    await this.saveTask(task);
    this.onTaskChange?.({ type: 'updated', task });
    return task;
  }

  async getTask(taskId: string): Promise<TaskRecord | null> { return this.loadTask(taskId); }
  async listTasks(): Promise<TaskRecord[]> { return this.store.listTasks(); }
  async deleteTask(taskId: string): Promise<void> { await this.store.deleteTask(taskId); }

  async canStart(taskId: string): Promise<boolean> {
    const task = await this.loadTask(taskId);
    if (!task) return false;
    for (const dependencyId of task.blockedBy) {
      if ((await this.loadTask(dependencyId))?.status !== 'completed') return false;
    }
    return true;
  }

  async getUnblockedTasks(completedTaskId: string): Promise<TaskRecord[]> {
    const tasks = await this.listTasks();
    const result: TaskRecord[] = [];
    for (const task of tasks) {
      if (task.status === 'pending' && task.blockedBy.includes(completedTaskId) && await this.canStart(task.id)) result.push(task);
    }
    return result;
  }

  private async assertNoDependencyCycle(taskId: string, dependencies: readonly string[]): Promise<void> {
    for (const dependencyId of dedupe(dependencies)) {
      if (dependencyId === taskId) throw new Error('Task cannot depend on itself.');
      if (await this.dependsOn(dependencyId, taskId)) throw new Error('Task dependency cycle detected.');
    }
  }

  private async dependsOn(fromId: string, targetId: string): Promise<boolean> {
    const visited = new Set<string>();
    const pending = [fromId];
    while (pending.length) {
      const currentId = pending.pop()!;
      if (currentId === targetId) return true;
      if (visited.has(currentId)) continue;
      visited.add(currentId);
      const current = await this.loadTask(currentId);
      for (const dependencyId of current?.blockedBy ?? []) if (!visited.has(dependencyId)) pending.push(dependencyId);
    }
    return false;
  }

  private async assertNoOtherInProgress(taskId: string): Promise<void> {
    const active = (await this.listTasks()).find((task) => task.id !== taskId && task.status === 'in_progress');
    if (active) throw new Error(`Only one task may be in_progress at a time: ${active.id}.`);
  }

  private async linkBlocks(upstreamId: string, downstreamId: string): Promise<void> {
    const upstream = await this.loadTask(upstreamId);
    if (!upstream || upstream.blocks.includes(downstreamId)) return;
    upstream.blocks = [...upstream.blocks, downstreamId];
    upstream.updatedAt = Date.now();
    await this.saveTask(upstream);
  }

  private async linkBlockedBy(downstreamId: string, upstreamId: string): Promise<void> {
    const downstream = await this.loadTask(downstreamId);
    if (!downstream || downstream.blockedBy.includes(upstreamId)) return;
    downstream.blockedBy = [...downstream.blockedBy, upstreamId];
    downstream.updatedAt = Date.now();
    await this.saveTask(downstream);
  }

  private async saveTask(task: TaskRecord): Promise<void> { await this.store.saveTask(task); }
  private async loadTask(taskId: string): Promise<TaskRecord | null> { return this.store.loadTask(taskId); }
  private generateId(): string { return `task_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`; }
}

function dedupe(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => typeof value === 'string' && value.length > 0))];
}

function appendUnique(target: string[], incoming: readonly string[]): string[] {
  const existing = new Set(target);
  const added: string[] = [];
  for (const value of incoming) {
    if (!existing.has(value)) {
      target.push(value);
      existing.add(value);
      added.push(value);
    }
  }
  return added;
}