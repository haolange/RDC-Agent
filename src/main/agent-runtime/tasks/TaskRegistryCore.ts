import * as crypto from 'crypto';
import { AppError } from '@shared/errors/appError';
import { FileTaskStore, type TaskStore } from './TaskStore';
import { projectTaskItems, type ProjectedTaskItem } from './taskProjection';
import { taskDependencyWait } from './taskDependencies';
import {
  assertApprovedTaskRequirement,
  assertTaskExecutionCompletion,
  assertIndependentReviewResult,
  canReexecuteInvalidatedTask,
} from './TaskExecutionRequirements';
import {
  appendUnique,
  collectDescendants,
  dedupeIds,
  isTerminalExecutionStatus,
  isTerminalTaskStatus,
} from './taskRegistryRules';
import type {
  StartTaskExecutionOptions,
  TaskCompletionResult,
  TaskExecutionRecord,
  TaskRecord,
  TaskRootBudgetRecord,
} from './TaskContracts';

/** Task trees whose cancellation or recovery interruption is in progress in this process. */
export const CANCELLING_TASK_TREES = new Set<string>();
export const INVALID_RESULT_REFERENCE =
  'Task result reference validation failed: provide an accessible owning-session URI and exact hash for the result being reviewed. A supporting receipt is not the result unless it is the actual work product.';
class TaskCompletionUnavailable extends AppError {
  constructor(message: string) {
    super('TASK_EXECUTION_REQUIREMENTS', message.replace(/^TASK_EXECUTION_REQUIREMENTS:\s*/, ''));
  }
}
const isCompletionUnavailable = (error: unknown): error is Error =>
  error instanceof TaskCompletionUnavailable ||
  (error instanceof Error && error.message.startsWith('TASK_EXECUTION_REQUIREMENTS:'));

export interface TaskRegistryOptions {
  onCancelExecution?: (execution: TaskExecutionRecord) => Promise<void>;
  validateResultRef?: (task: TaskRecord, result: TaskCompletionResult) => Promise<boolean>;
}

/**
 * TaskRegistryCore — record access, dependency-graph integrity, ancestor state and completion
 * validation shared by every TaskRegistry mutation. Nothing here writes the store.
 */
export class TaskRegistryCore {
  onTaskChange?: (event: { type: 'created' | 'updated'; task: TaskRecord; snapshot: ProjectedTaskItem[] }) => void;
  protected readonly store: TaskStore;
  protected readonly options: TaskRegistryOptions;
  constructor(storeOrDir: TaskStore | string, options: TaskRegistryOptions = {}) {
    this.store = typeof storeOrDir === 'string' ? new FileTaskStore(storeOrDir) : storeOrDir;
    this.options = options;
  }

  /** The host-resolved hash of a result reference; a reference naming no reviewable result is refused. */
  async resolveResultReference(uri: string): Promise<string> {
    const hash = await this.store.reviewArtifactHash?.(uri);
    if (!hash)
      throw new Error(
        'The result reference names no current session result. Settle with the exact session:// URI the result was saved under.',
      );
    return hash;
  }

  async getExecution(id: string): Promise<TaskExecutionRecord | null> {
    return this.store.loadExecution(id);
  }
  async getRootBudget(id: string): Promise<TaskRootBudgetRecord | null> {
    return this.store.loadRootBudget(id);
  }
  async listExecutions(taskId?: string): Promise<TaskExecutionRecord[]> {
    return this.store.listExecutions(taskId);
  }
  async getTask(id: string): Promise<TaskRecord | null> {
    return this.store.loadTask(id);
  }
  async listTasks(): Promise<TaskRecord[]> {
    return this.store.listTasks();
  }
  async readConsistentSnapshot(): Promise<{ tasks: TaskRecord[]; executions: TaskExecutionRecord[] }> {
    return this.store.withLock('state', async () => ({
      tasks: await this.currentTaskProjection(),
      executions: await this.store.listExecutions(),
    }));
  }
  async canStart(id: string): Promise<boolean> {
    const task = await this.store.loadTask(id);
    if (!task) return false;
    for (const dependencyId of task.blockedBy) {
      const dependency = await this.store.loadTask(dependencyId);
      const proof = dependency?.currentExecutionId
        ? await this.store.loadExecution(dependency.currentExecutionId)
        : undefined;
      if (taskDependencyWait(dependencyId, dependency, proof)) return false;
      if (dependency) {
        try {
          await this.assertCanComplete(dependency, undefined, new Set([task.id]));
        } catch (error) {
          if (isCompletionUnavailable(error)) return false;
          throw error;
        }
      }
    }
    return true;
  }
  async getUnblockedTasks(completedId: string): Promise<TaskRecord[]> {
    const candidates = (await this.listTasks()).filter(
      (x) => x.status === 'pending' && x.blockedBy.includes(completedId),
    );
    const checks = await Promise.all(candidates.map((x) => this.canStart(x.id)));
    return candidates.filter((_x, index) => checks[index]);
  }
  protected async emitTaskChange(type: 'created' | 'updated', task: TaskRecord): Promise<void> {
    if (!this.onTaskChange) return;
    this.onTaskChange({
      type,
      task,
      snapshot: projectTaskItems(await this.currentTaskProjection(), await this.store.listExecutions()),
    });
  }
  protected async assertApprovedRequirement(task: TaskRecord): Promise<void> {
    assertApprovedTaskRequirement(task, (await this.store.readApprovedRequirements?.()) ?? []);
  }
  protected async assertCancelledContinuation(task: TaskRecord, options: StartTaskExecutionOptions): Promise<void> {
    if (task.status !== 'cancelled' || options.mode !== 'direct' || options.parentExecutionId) {
      throw new Error('Only the owning direct turn can explicitly resume a cancelled Task.');
    }
    const current = task.currentExecutionId ? await this.store.loadExecution(task.currentExecutionId) : null;
    const priorTurn = current?.frozenPlanRef ?? task.creationTurnRef;
    if (!priorTurn?.trim() || !options.frozenPlanRef?.trim() || priorTurn.trim() === options.frozenPlanRef.trim()) {
      throw new Error('Cancelled Task continuation requires a later turn with a frozen execution identity.');
    }
    const tree = [task, ...collectDescendants(task.id, await this.store.listTasks())];
    for (const member of tree) {
      if (
        CANCELLING_TASK_TREES.has(member.id) ||
        (await this.store.listExecutions(member.id)).some((execution) => !isTerminalExecutionStatus(execution.status))
      ) {
        throw new Error('Cancelled Task continuation must wait for every owned producer to join.');
      }
    }
  }
  protected async assertCanComplete(
    task: TaskRecord,
    result?: TaskCompletionResult,
    visiting = new Set<string>(),
  ): Promise<void> {
    if (visiting.has(task.id))
      throw new TaskCompletionUnavailable('TASK_EXECUTION_REQUIREMENTS: cyclic Task completion dependency.');
    visiting.add(task.id);
    try {
      await this.assertApprovedRequirement(task);
      if (!task.executionRequired) {
        await this.assertCompletionClosure(task, visiting);
        return;
      }
      if (!task.currentExecutionId)
        throw new TaskCompletionUnavailable('Executable task cannot complete without an execution.');
      const execution = await this.requireExecution(task.currentExecutionId);
      if (!isTerminalExecutionStatus(execution.status))
        throw new TaskCompletionUnavailable('Task execution has not settled.');
      if (
        execution.taskRevision !== task.revision ||
        execution.status !== 'completed' ||
        execution.result?.disposition !== 'completed'
      ) {
        throw new TaskCompletionUnavailable(
          'Task completion requires a completed execution result for the current task revision.',
        );
      }
      if (result && JSON.stringify(result) !== JSON.stringify(execution.result)) {
        if (await canReexecuteInvalidatedTask(task, this.store)) {
          throw new TaskCompletionUnavailable(
            'Task completion result cannot replace the execution owner result; start a new execution and settle it with a verifiable resultRef.',
          );
        }
        throw new TaskCompletionUnavailable('Task completion result cannot replace the execution owner result.');
      }
      const effective = execution.result;
      await assertTaskExecutionCompletion(task, execution, this.store);
      await assertIndependentReviewResult(task, effective, this.store);
      const missing = task.completionRequirements.filter((key) => !effective.outputs[key]);
      if (missing.length)
        throw new TaskCompletionUnavailable(`Task result is missing requirements: ${missing.join(', ')}`);
      await this.assertCompletionClosure(task, visiting);
      if (this.options.validateResultRef && !(await this.options.validateResultRef(task, effective)))
        throw new TaskCompletionUnavailable(INVALID_RESULT_REFERENCE);
    } finally {
      visiting.delete(task.id);
    }
  }
  protected async assertCompletionClosure(task: TaskRecord, visiting = new Set([task.id])): Promise<void> {
    for (const id of task.blockedBy) {
      const dependency = await this.store.loadTask(id);
      const proof = dependency?.currentExecutionId
        ? await this.store.loadExecution(dependency.currentExecutionId)
        : undefined;
      if (taskDependencyWait(id, dependency, proof))
        throw new TaskCompletionUnavailable('Task dependencies are not completed with verified results.');
      if (dependency) await this.assertCanComplete(dependency, undefined, visiting);
    }
    const children = (await this.store.listTasks()).filter((candidate) => candidate.parentTaskId === task.id);
    const unresolved = children.filter((child) => child.status !== 'completed' && child.status !== 'cancelled');
    if (unresolved.length)
      throw new TaskCompletionUnavailable(
        `Task has unresolved child tasks: ${unresolved.map((child) => child.id).join(', ')}`,
      );
    if (children.some((child) => child.status === 'cancelled' || child.disposition !== 'completed')) {
      throw new TaskCompletionUnavailable(
        'Parent task with partial, blocked, or cancelled child work cannot be completed.',
      );
    }
    for (const child of children) await this.assertCanComplete(child, undefined, visiting);
  }
  protected async currentTaskProjection(): Promise<TaskRecord[]> {
    const tasks = await this.store.listTasks();
    return Promise.all(
      tasks.map(async (task) => {
        if (task.status !== 'completed') return task;
        try {
          await this.assertCanComplete(task);
          return task;
        } catch (error) {
          if (!isCompletionUnavailable(error)) throw error;
          return {
            ...task,
            status: 'blocked' as const,
            statusReason: `Completion requires revalidation: ${error.message}`,
          };
        }
      }),
    );
  }
  protected async canContinueInvalidatedTask(task: TaskRecord): Promise<boolean> {
    if (await canReexecuteInvalidatedTask(task, this.store)) return true;
    if (task.status !== 'blocked') return false;
    const executions = await this.store.listExecutions(task.id);
    const previous = executions.filter((execution) => execution.status === 'completed').at(-1);
    return previous
      ? canReexecuteInvalidatedTask({ ...task, status: 'completed', currentExecutionId: previous.id }, this.store)
      : false;
  }
  protected assertCurrent(task: TaskRecord, execution: TaskExecutionRecord, generation: number): void {
    if (
      execution.generation !== generation ||
      task.currentExecutionId !== execution.id ||
      execution.taskRevision !== task.revision
    )
      throw new Error('Stale task execution generation or revision.');
  }
  protected async updateLinks(
    task: TaskRecord,
    updates: { addBlockedBy?: string[]; addBlocks?: string[] },
  ): Promise<TaskRecord[]> {
    const changed = new Map<string, TaskRecord>();
    const dependencies = dedupeIds(updates.addBlockedBy ?? []);
    await this.assertDependenciesExist(dependencies);
    await this.assertNoDependencyCycle(task.id, dependencies);
    for (const id of appendUnique(task.blockedBy, dependencies)) {
      const upstream = await this.requireTask(id);
      if (!upstream.blocks.includes(task.id)) {
        upstream.blocks.push(task.id);
        upstream.updatedAt = Date.now();
        changed.set(upstream.id, upstream);
      }
    }
    for (const id of dedupeIds(updates.addBlocks ?? [])) {
      await this.assertDependenciesExist([id]);
      await this.assertNoDependencyCycle(id, [task.id]);
      const downstream = await this.requireTask(id);
      if (isTerminalTaskStatus(downstream.status))
        throw new Error(`Cannot revise dependency graph for terminal task: ${downstream.id}`);
      if (downstream.currentExecutionId) {
        const active = await this.store.loadExecution(downstream.currentExecutionId);
        if (active && !isTerminalExecutionStatus(active.status))
          throw new Error(`Cannot revise dependency graph for active task: ${downstream.id}`);
      }
      if (appendUnique(task.blocks, [id]).length && !downstream.blockedBy.includes(task.id)) {
        downstream.blockedBy.push(task.id);
        downstream.revision += 1;
        downstream.updatedAt = Date.now();
        changed.set(downstream.id, downstream);
      }
    }
    return [...changed.values()];
  }
  protected async assertDependenciesExist(ids: string[]): Promise<void> {
    for (const id of ids) if (!(await this.store.loadTask(id))) throw new Error(`Task dependency not found: ${id}`);
  }
  protected async assertNoDependencyCycle(taskId: string, dependencies: string[]): Promise<void> {
    for (const dependency of dependencies) {
      if (dependency === taskId) throw new Error('Task cannot depend on itself.');
      if (await this.dependsOn(dependency, taskId)) throw new Error('Task dependency cycle detected.');
    }
  }
  protected async dependsOn(from: string, target: string): Promise<boolean> {
    const seen = new Set<string>();
    const pending = [from];
    while (pending.length) {
      const id = pending.pop()!;
      if (id === target) return true;
      if (seen.has(id)) continue;
      seen.add(id);
      const task = await this.store.loadTask(id);
      pending.push(...(task?.blockedBy ?? []));
    }
    return false;
  }
  protected async requireTask(id: string): Promise<TaskRecord> {
    const task = await this.store.loadTask(id);
    if (!task) throw new Error(`Task not found: ${id}`);
    return task;
  }
  protected async requireExecution(id: string): Promise<TaskExecutionRecord> {
    const value = await this.store.loadExecution(id);
    if (!value) throw new Error(`Task execution not found: ${id}`);
    return value;
  }
  protected async hasCancellingAncestor(taskId: string): Promise<boolean> {
    let current: string | undefined = taskId;
    while (current) {
      if (CANCELLING_TASK_TREES.has(current)) return true;
      current = (await this.store.loadTask(current))?.parentTaskId;
    }
    return false;
  }
  protected async hasUnavailableAncestor(taskId: string, allowCompleted = false): Promise<boolean> {
    let current: string | undefined = taskId;
    while (current) {
      const task = await this.store.loadTask(current);
      if (
        !task ||
        task.status === 'cancelled' ||
        (task.status === 'completed' && !allowCompleted) ||
        CANCELLING_TASK_TREES.has(current)
      )
        return true;
      if (task.currentExecutionId && (await this.store.loadExecution(task.currentExecutionId))?.status === 'cancelling')
        return true;
      current = task.parentTaskId;
    }
    return false;
  }
  protected id(prefix: string, now: number): string {
    return `${prefix}_${now}_${crypto.randomBytes(4).toString('hex')}`;
  }
}
