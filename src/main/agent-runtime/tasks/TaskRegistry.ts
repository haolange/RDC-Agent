import * as crypto from 'crypto';
import { FileTaskStore, type TaskStore } from './TaskStore';
import {
  TASK_SCHEMA_VERSION, type SettleTaskExecutionOptions, type StartTaskExecutionOptions,
  type TaskCompletionResult, type TaskExecutionMessage, type TaskExecutionRecord,
  type TaskMessageKind, type TaskRecord, type TaskRootBudgetRecord, type TaskStatus,
} from './TaskContracts';
import { cancelOwnedTaskExecution } from './TaskExecutionOwners';
import { projectTaskItems, type ProjectedTaskItem } from './taskProjection';

const TASK_RUNTIME_INSTANCE_ID = crypto.randomUUID();
const CANCELLING_TASK_TREES = new Set<string>();

export type { TaskCompletionResult, TaskExecutionMessage, TaskExecutionRecord, TaskRecord, TaskStatus } from './TaskContracts';

export interface CreateTaskOptions {
  description?: string; blockedBy?: string[]; owner?: string; parentTaskId?: string;
  completionRequirements?: string[]; executionRequired?: boolean; metadata?: Record<string, unknown>;
}
export interface UpdateTaskOptions {
  status?: TaskStatus; statusReason?: string; subject?: string; description?: string; owner?: string;
  addBlockedBy?: string[]; addBlocks?: string[]; completionRequirements?: string[]; metadata?: Record<string, unknown>;
  result?: TaskCompletionResult;
}
export interface TaskRegistryOptions {
  onCancelExecution?: (execution: TaskExecutionRecord) => Promise<void>;
  validateResultRef?: (task: TaskRecord, result: TaskCompletionResult) => Promise<boolean>;
}

export class TaskRegistry {
  onTaskChange?: (event: { type: 'created' | 'updated'; task: TaskRecord; snapshot: ProjectedTaskItem[] }) => void;
  private readonly store: TaskStore; private readonly options: TaskRegistryOptions;
  constructor(storeOrDir: TaskStore | string, options: TaskRegistryOptions = {}) { this.store = typeof storeOrDir === 'string' ? new FileTaskStore(storeOrDir) : storeOrDir; this.options = options; }

  async createTask(subject: string, options: CreateTaskOptions = {}): Promise<TaskRecord> { return (await this.createTasks([{ subject, ...options }]))[0]!; }
  async createTasks(inputs: ReadonlyArray<{ subject: string } & CreateTaskOptions>): Promise<TaskRecord[]> {
    if (!inputs.length) throw new Error('At least one task is required.');
    return this.store.withLock('state', async () => {
      const prepared: TaskRecord[] = []; const base = Date.now();
      for (const [index, input] of inputs.entries()) {
        if (!input.subject.trim()) throw new Error('Task subject is required.');
        const createdAt = base + index; const id = this.id('task', createdAt); const blockedBy = dedupe(input.blockedBy ?? []);
        await this.assertDependenciesExist(blockedBy); await this.assertNoDependencyCycle(id, blockedBy);
        if (input.parentTaskId) {
          const parent = await this.store.loadTask(input.parentTaskId);
          if (!parent) throw new Error(`Parent task not found: ${input.parentTaskId}`);
          if (await this.hasUnavailableAncestor(parent.id)) throw new Error('Cannot add a child to a terminal or cancelling parent task tree.');
          if (parent.currentExecutionId) {
            const parentExecution = await this.store.loadExecution(parent.currentExecutionId);
            if (parentExecution?.status === 'cancelling') throw new Error('Cannot add a child to a terminal or cancelling parent task.');
          }
        }
        prepared.push({ schemaVersion: TASK_SCHEMA_VERSION, id, subject: input.subject.trim(), description: input.description ?? '', status: 'pending', owner: input.owner, parentTaskId: input.parentTaskId, blockedBy, blocks: [], completionRequirements: dedupe(input.completionRequirements ?? []), executionRequired: input.executionRequired !== false, executionIds: [], revision: 1, metadata: input.metadata ? { ...input.metadata } : undefined, createdAt, updatedAt: createdAt });
      }
      const changed = new Map(prepared.map((task) => [task.id, task]));
      for (const task of prepared) {
        for (const upstreamId of task.blockedBy) {
          const upstream = changed.get(upstreamId) ?? await this.requireTask(upstreamId);
          if (!upstream.blocks.includes(task.id)) upstream.blocks.push(task.id);
          changed.set(upstream.id, upstream);
        }
      }
      await this.store.commit({ tasks: [...changed.values()] });
      await this.emitTaskChange('created', prepared.at(-1)!); return prepared;
    });
  }

  async updateTask(taskId: string, updates: UpdateTaskOptions): Promise<TaskRecord> {
    if (updates.status === 'cancelled') return this.cancelTask(taskId, updates.statusReason);
    return this.store.withLock('state', async () => {
      const task = await this.requireTask(taskId); const next = updates.status ?? task.status;
      if (terminalTask(task.status) && next !== task.status) throw new Error(`Terminal task cannot transition from ${task.status} to ${next}.`);
      const semanticsChanged = updates.subject !== undefined || updates.description !== undefined || updates.completionRequirements !== undefined || Boolean(updates.addBlockedBy?.length) || Boolean(updates.addBlocks?.length);
      if (terminalTask(task.status) && semanticsChanged) {
        throw new Error('Terminal task semantics are immutable; create or reopen a new task revision explicitly.');
      }
      if (next === 'blocked' && !(updates.statusReason ?? task.statusReason)?.trim()) throw new Error('Blocked tasks require a statusReason.');
      if (next === 'in_progress' && !await this.canStart(taskId)) throw new Error('Task dependencies are not completed with verified results.');
      if (next === 'in_progress' && task.executionRequired && !task.currentExecutionId) throw new Error('Executable tasks must be started through startExecution.');
      if (next === 'blocked' && task.currentExecutionId) { const active = await this.store.loadExecution(task.currentExecutionId); if (active && !terminal(active.status)) throw new Error('Settle or cancel the active execution before blocking its task.'); }
      if (next === 'completed') await this.assertCanComplete(task, updates.result);
      if (semanticsChanged && task.currentExecutionId) {
        const active = await this.store.loadExecution(task.currentExecutionId);
        if (active && !terminal(active.status)) throw new Error('Cancel and join the current execution before revising its task.');
      }
      const relatedTasks = updates.addBlockedBy?.length || updates.addBlocks?.length ? await this.updateLinks(task, updates) : [];
      if (updates.subject !== undefined) task.subject = updates.subject.trim();
      if (updates.description !== undefined) task.description = updates.description;
      if (updates.owner !== undefined) task.owner = updates.owner;
      if (updates.completionRequirements !== undefined) task.completionRequirements = dedupe(updates.completionRequirements);
      if (updates.metadata !== undefined) task.metadata = { ...(task.metadata ?? {}), ...updates.metadata };
      task.status = next; task.statusReason = updates.statusReason ?? (next === 'blocked' ? task.statusReason : undefined);
      task.disposition = updates.result?.disposition ?? (next === 'cancelled' ? 'cancelled' : next === 'blocked' ? 'blocked' : task.disposition);
      if (semanticsChanged) task.revision += 1; task.updatedAt = Date.now();
      await this.store.commit({ tasks: [task, ...relatedTasks] });
      await this.emitTaskChange('updated', task); return task;
    });
  }

  async startExecution(taskId: string, options: StartTaskExecutionOptions): Promise<TaskExecutionRecord> {
    return this.store.withLock('state', async () => {
      const task = await this.requireTask(taskId); if (task.parentTaskId && await this.hasUnavailableAncestor(task.parentTaskId)) throw new Error('Task ancestor is terminal or cancelling.'); if (await this.hasCancellingAncestor(taskId)) throw new Error('Task or ancestor cancellation is in progress.'); if (!await this.canStart(taskId)) throw new Error('Task dependencies are not completed with verified results.');
      if (terminalTask(task.status)) throw new Error(`Terminal task cannot start another execution: ${task.status}.`);
      if (task.status === 'in_progress') throw new Error('An in-progress task cannot start another execution.');
      if (task.currentExecutionId) { const current = await this.store.loadExecution(task.currentExecutionId); if (current && !terminal(current.status)) throw new Error(`Task already has an active execution: ${current.id}`); }
      const previous = await this.store.listExecutions(taskId);
      const generation = Math.max(0, ...previous.map((x) => x.generation)) + 1;
      const parent = options.parentExecutionId ? await this.requireExecution(options.parentExecutionId) : undefined;
      const rootBudgetId = parent?.rootBudgetId ?? previous.at(-1)?.rootBudgetId ?? options.rootBudgetId;
      if (rootBudgetId) {
        const rootBudget = await this.store.loadRootBudget(rootBudgetId);
        if (!rootBudget) throw new Error('Root Task budget does not exist.');
        if (rootBudget.deadlineAt <= Date.now() || rootBudget.toolCalls >= rootBudget.maxToolCalls || rootBudget.subagents > rootBudget.maxSubagents) {
          throw new Error('Root Task budget is exhausted.');
        }
      }
      const budget = inheritBudget(options.budget, previous.at(-1)?.budget, parent?.budget);
      validateBudget(budget);
      const now = Date.now();
      const execution: TaskExecutionRecord = { schemaVersion: TASK_SCHEMA_VERSION, id: this.id('execution', now), taskId, taskRevision: task.revision, generation, runtimeInstanceId: TASK_RUNTIME_INSTANCE_ID, parentExecutionId: options.parentExecutionId, rootBudgetId, mode: options.mode, status: 'running', budget, frozenPlanRef: options.frozenPlanRef, childMessageAckSequence: 0, parentMessageAckSequence: 0, createdAt: now, updatedAt: now };
      task.executionIds = [...task.executionIds, execution.id]; task.currentExecutionId = execution.id; task.status = 'in_progress'; task.statusReason = undefined; task.disposition = undefined; task.updatedAt = now;
      await this.store.commit({ tasks: [task], executions: [execution] });
      await this.emitTaskChange('updated', task); return execution;
    });
  }

  async settleExecution(id: string, options: SettleTaskExecutionOptions): Promise<TaskExecutionRecord> {
    await this.requireExecution(id);
    return this.store.withLock('state', async () => {
      const execution = await this.requireExecution(id); const task = await this.requireTask(execution.taskId);
      this.assertCurrent(task, execution, options.expectedGeneration);
      if (terminal(execution.status)) {
        if (sameSettlement(execution, options)) return execution;
        throw new Error('Task execution is already settled with a different terminal result.');
      }
      if (execution.status === 'cancelling' && options.status !== 'cancelled') throw new Error('Task execution cancellation is in progress.');
      if (!terminal(options.status)) throw new Error('Execution status is not terminal.');
      validateResult(options.result, options.status);
      if (this.options.validateResultRef && !await this.options.validateResultRef(task, options.result)) throw new Error('Task result reference validation failed.');
      const missing = task.completionRequirements.filter((key) => !options.result.outputs[key]);
      if (options.result.disposition === 'completed' && missing.length) throw new Error(`Task result is missing requirements: ${missing.join(', ')}`);
      if (options.result.disposition === 'completed' && options.result.missingRequirements?.length) {
        throw new Error('Completed task result cannot declare missing requirements.');
      }
      if (options.result.disposition === 'completed') await this.assertCompletionClosure(task, options.result);
      execution.status = options.status; execution.result = options.result; execution.updatedAt = Date.now(); execution.settledAt = execution.updatedAt;
      task.status = options.result.disposition === 'completed' ? 'completed' : options.result.disposition === 'cancelled' ? 'cancelled' : 'blocked';
      task.disposition = options.result.disposition; task.statusReason = options.result.disposition === 'completed' ? undefined : options.result.summary; task.updatedAt = execution.updatedAt;
      await this.store.commit({ tasks: [task], executions: [execution] });
      await this.emitTaskChange('updated', task); return execution;
    });
  }

  async updateExecutionStatus(id: string, status: 'running' | 'waiting', expectedGeneration: number): Promise<TaskExecutionRecord> { await this.requireExecution(id); return this.store.withLock('state', async () => { const execution = await this.requireExecution(id); const task = await this.requireTask(execution.taskId); this.assertCurrent(task, execution, expectedGeneration); if (terminal(execution.status) || execution.status === 'cancelling') throw new Error('Settled or cancelling execution cannot return to a running state.'); execution.status = status; execution.updatedAt = Date.now(); await this.store.saveExecution(execution); return execution; }); }
  async updateExecutionBudget(id: string, input: {
    expectedGeneration: number;
    toolCalls?: number;
    subagents?: number;
    childDepth?: number;
    maxToolCalls?: number;
    maxSubagents?: number;
    maxChildDepth?: number;
    deadlineAt?: number;
  }): Promise<TaskExecutionRecord> {
    return this.store.withLock('state', async () => {
      const execution = await this.requireExecution(id);
      const task = await this.requireTask(execution.taskId);
      this.assertCurrent(task, execution, input.expectedGeneration);
      if (terminal(execution.status)) throw new Error('Settled execution budget cannot be changed.');
      const next = { ...execution.budget };
      for (const key of ['toolCalls', 'subagents', 'childDepth'] as const) {
        const value = input[key];
        if (value === undefined) continue;
        const previous = next[key] ?? 0;
        if (!Number.isFinite(value) || value < previous) throw new Error(`Execution budget counter must be finite and monotonic: ${key}.`);
        next[key] = value;
      }
      for (const key of ['maxToolCalls', 'maxSubagents', 'maxChildDepth', 'deadlineAt'] as const) {
        const value = input[key];
        if (value === undefined) continue;
        const previous = next[key];
        if (!Number.isFinite(value) || value < 0 || (previous !== undefined && value > previous)) {
          throw new Error(`Execution budget ceiling may only be narrowed: ${key}.`);
        }
        next[key] = value;
      }
      validateBudget(next);
      execution.budget = next;
      execution.updatedAt = Date.now();
      await this.store.saveExecution(execution);
      return execution;
    });
  }
  async appendExecutionMessage(id: string, input: { expectedGeneration: number; kind: TaskMessageKind; direction: TaskExecutionMessage['direction']; body: string }): Promise<TaskExecutionMessage> { await this.requireExecution(id); return this.store.withLock('state', async () => { const execution = await this.requireExecution(id); const task = await this.requireTask(execution.taskId); this.assertCurrent(task, execution, input.expectedGeneration); if (!input.body.trim()) throw new Error('Message body is required.'); const existing = await this.store.listMessages(id); const sequence = (existing.at(-1)?.sequence ?? 0) + 1; const message = { schemaVersion: TASK_SCHEMA_VERSION, id: `${id}:${sequence}`, taskId: task.id, executionId: id, generation: execution.generation, sequence, kind: input.kind, direction: input.direction, body: input.body, createdAt: Date.now() } satisfies TaskExecutionMessage; await this.store.appendMessage(message); return message; }); }
  async consumeExecutionMessages(id: string, afterSequence = 0, direction?: TaskExecutionMessage['direction']): Promise<{ messages: TaskExecutionMessage[]; cursor: number }> { const messages = (await this.store.listMessages(id, afterSequence)).filter((message) => !direction || message.direction === direction); return { messages, cursor: messages.at(-1)?.sequence ?? afterSequence }; }
  async ackExecutionMessages(id: string, input: { expectedGeneration: number; throughSequence: number; direction: 'to_child' | 'to_parent' }): Promise<TaskExecutionRecord> { return this.store.withLock('state', async () => { const execution = await this.requireExecution(id); const task = await this.requireTask(execution.taskId); this.assertCurrent(task, execution, input.expectedGeneration); const cursorKey = input.direction === 'to_child' ? 'childMessageAckSequence' : 'parentMessageAckSequence'; const cursor = execution[cursorKey]; if (!Number.isInteger(input.throughSequence) || input.throughSequence < cursor) throw new Error('Message acknowledgement cursor must be monotonic.'); if (input.throughSequence === cursor) return execution; const messages = await this.store.listMessages(id, cursor); if (!messages.some((message) => message.direction === input.direction && message.sequence === input.throughSequence)) throw new Error('Message acknowledgement must reference a delivered message in the requested direction.'); execution[cursorKey] = input.throughSequence; execution.updatedAt = Date.now(); await this.store.saveExecution(execution); return execution; }); }
  async bindExecutionPlanRef(id: string, input: { expectedGeneration: number; frozenPlanRef: string }): Promise<TaskExecutionRecord> { return this.store.withLock('state', async () => { const execution = await this.requireExecution(id); const task = await this.requireTask(execution.taskId); this.assertCurrent(task, execution, input.expectedGeneration); if (!input.frozenPlanRef.trim()) throw new Error('Frozen plan reference is required.'); if (execution.frozenPlanRef && execution.frozenPlanRef !== input.frozenPlanRef) throw new Error('Execution frozen plan reference is already bound.'); if (execution.frozenPlanRef === input.frozenPlanRef) return execution; execution.frozenPlanRef = input.frozenPlanRef; execution.updatedAt = Date.now(); await this.store.saveExecution(execution); return execution; }); }
  async reconcileInterruptedExecutions(): Promise<TaskExecutionRecord[]> {
    return this.store.withLock('state', async () => {
      const active = (await this.store.listExecutions()).filter((execution) => !terminal(execution.status) && execution.runtimeInstanceId !== TASK_RUNTIME_INSTANCE_ID);
      const now = Date.now();
      const changedTasks: TaskRecord[] = [];
      for (const execution of active) {
        execution.status = 'interrupted';
        execution.result = { disposition: 'blocked', summary: 'Execution was interrupted by runtime restart and requires explicit recovery.', outputs: {} };
        execution.updatedAt = now;
        execution.settledAt = now;
        const task = await this.requireTask(execution.taskId);
        if (task.currentExecutionId === execution.id) {
          task.status = 'blocked'; task.disposition = 'blocked'; task.statusReason = execution.result.summary; task.updatedAt = now; changedTasks.push(task);
        }
      }
      if (active.length) await this.store.commit({ tasks: changedTasks, executions: active });
      return active;
    });
  }
  async cancelTask(taskId: string, reason = 'Cancelled by task owner.'): Promise<TaskRecord> {
    if (CANCELLING_TASK_TREES.has(taskId)) throw new Error('Task cancellation is already in progress.');
    CANCELLING_TASK_TREES.add(taskId);
    const marked = new Set([taskId]);
    try {
      const tasks = await this.listTasks();
      const descendants = collectDescendants(taskId, tasks).reverse();
      for (const descendant of descendants) {
        CANCELLING_TASK_TREES.add(descendant.id);
        marked.add(descendant.id);
        if (!terminalTask(descendant.status)) await this.cancelSingleTask(descendant.id, `Cancelled with parent task ${taskId}.`);
      }
      return await this.cancelSingleTask(taskId, reason);
    } finally {
      for (const id of marked) CANCELLING_TASK_TREES.delete(id);
    }
  }

  private async cancelSingleTask(taskId: string, reason: string): Promise<TaskRecord> {
    const intent = await this.store.withLock('state', async () => {
      const task = await this.requireTask(taskId);
      if (task.status === 'completed') throw new Error('Completed task cannot be cancelled.');
      if (task.status === 'cancelled') return { task, execution: undefined };
      if (!task.currentExecutionId) {
        task.status = 'cancelled'; task.disposition = 'cancelled'; task.statusReason = reason; task.updatedAt = Date.now();
        await this.store.saveTask(task); await this.emitTaskChange('updated', task); return { task, execution: undefined };
      }
      const execution = await this.requireExecution(task.currentExecutionId);
      if (terminal(execution.status)) {
        task.status = 'cancelled'; task.disposition = 'cancelled'; task.statusReason = reason; task.updatedAt = Date.now();
        await this.store.saveTask(task); await this.emitTaskChange('updated', task); return { task, execution: undefined };
      }
      execution.status = 'cancelling'; execution.updatedAt = Date.now();
      const previousStatusReason = task.statusReason;
      task.statusReason = `Cancellation requested; waiting for execution exit. ${reason}`; task.updatedAt = execution.updatedAt;
      await this.store.commit({ tasks: [task], executions: [execution] });
      await this.emitTaskChange('updated', task);
      return { task, execution, previousStatusReason };
    });
    if (!intent.execution) return intent.task;
    const owned = this.options.onCancelExecution
      ? (await this.options.onCancelExecution(intent.execution), true)
      : await cancelOwnedTaskExecution(intent.execution);
    if (intent.execution.mode !== 'direct' && !owned) {
      await this.store.withLock('state', async () => {
        const execution = await this.requireExecution(intent.execution!.id);
        if (execution.status === 'cancelling') {
          execution.status = 'running';
          execution.updatedAt = Date.now();
          const task = await this.requireTask(taskId);
          task.statusReason = intent.previousStatusReason;
          task.updatedAt = execution.updatedAt;
          await this.store.commit({ tasks: [task], executions: [execution] });
          await this.emitTaskChange('updated', task);
        }
      });
      throw new Error('Managed execution cancellation requires a registered abort-and-join owner.');
    }
    return this.store.withLock('state', async () => {
      const task = await this.requireTask(taskId); const execution = await this.requireExecution(intent.execution!.id);
      this.assertCurrent(task, execution, intent.execution!.generation);
      if (execution.status === 'cancelled' && execution.result?.disposition === 'cancelled') return task;
      if (execution.status !== 'cancelling') throw new Error('Task execution changed while cancellation was in progress.');
      execution.status = 'cancelled'; execution.result = { disposition: 'cancelled', summary: reason, outputs: {} }; execution.updatedAt = Date.now(); execution.settledAt = execution.updatedAt;
      task.status = 'cancelled'; task.disposition = 'cancelled'; task.statusReason = reason; task.updatedAt = execution.updatedAt;
      await this.store.commit({ tasks: [task], executions: [execution] }); await this.emitTaskChange('updated', task); return task;
    });
  }
  async getExecution(id: string): Promise<TaskExecutionRecord | null> { return this.store.loadExecution(id); }
  async getRootBudget(id: string): Promise<TaskRootBudgetRecord | null> { return this.store.loadRootBudget(id); }
  async updateRootBudget(id: string, snapshot: Omit<TaskRootBudgetRecord, 'id' | 'updatedAt'>): Promise<TaskRootBudgetRecord> {
    return this.store.withLock('state', async () => {
      const current = await this.store.loadRootBudget(id);
      const next: TaskRootBudgetRecord = {
        id,
        toolCalls: Math.max(current?.toolCalls ?? 0, snapshot.toolCalls),
        subagents: Math.max(current?.subagents ?? 0, snapshot.subagents),
        maxToolCalls: Math.min(current?.maxToolCalls ?? snapshot.maxToolCalls, snapshot.maxToolCalls),
        maxSubagents: Math.min(current?.maxSubagents ?? snapshot.maxSubagents, snapshot.maxSubagents),
        maxChildDepth: Math.min(current?.maxChildDepth ?? snapshot.maxChildDepth, snapshot.maxChildDepth),
        deadlineAt: Math.min(current?.deadlineAt ?? snapshot.deadlineAt, snapshot.deadlineAt),
        startedAt: Math.min(current?.startedAt ?? snapshot.startedAt, snapshot.startedAt),
        updatedAt: Date.now(),
      };
      validateRootBudget(next);
      await this.store.saveRootBudget(next);
      return next;
    });
  }
  async listExecutions(taskId?: string): Promise<TaskExecutionRecord[]> { return this.store.listExecutions(taskId); }
  async getTask(id: string): Promise<TaskRecord | null> { return this.store.loadTask(id); }
  async listTasks(): Promise<TaskRecord[]> { return this.store.listTasks(); }
  private async emitTaskChange(type: 'created' | 'updated', task: TaskRecord): Promise<void> {
    if (!this.onTaskChange) return;
    this.onTaskChange({ type, task, snapshot: projectTaskItems(await this.store.listTasks()) });
  }
  async readConsistentSnapshot(): Promise<{ tasks: TaskRecord[]; executions: TaskExecutionRecord[] }> { return this.store.withLock('state', async () => ({ tasks: await this.store.listTasks(), executions: await this.store.listExecutions() })); }
  async deleteTask(id: string): Promise<void> { await this.store.withLock('state', async () => { const task = await this.requireTask(id); if (task.executionIds.length) throw new Error('Executed tasks retain their durable results and cannot be deleted.'); const related = (await this.store.listTasks()).filter((candidate) => candidate.id !== id && (candidate.blockedBy.includes(id) || candidate.blocks.includes(id) || candidate.parentTaskId === id)); if (related.some((candidate) => candidate.parentTaskId === id)) throw new Error('Cannot delete a task while child tasks still exist.'); for (const candidate of related) { if (candidate.currentExecutionId) { const active = await this.store.loadExecution(candidate.currentExecutionId); if (active && !terminal(active.status)) throw new Error(`Cannot revise graph for active task: ${candidate.id}`); } candidate.blockedBy = candidate.blockedBy.filter((entry) => entry !== id); candidate.blocks = candidate.blocks.filter((entry) => entry !== id); candidate.revision += 1; candidate.updatedAt = Date.now(); } await this.store.commit({ tasks: related, deletedTaskIds: [id] }); }); }
  async canStart(id: string): Promise<boolean> {
    const task = await this.store.loadTask(id);
    if (!task) return false;
    for (const dependencyId of task.blockedBy) {
      const dependency = await this.store.loadTask(dependencyId);
      if (!dependency || dependency.status !== 'completed' || dependency.disposition !== 'completed') return false;
      if (dependency.executionRequired) {
        if (!dependency.currentExecutionId) return false;
        const proof = await this.store.loadExecution(dependency.currentExecutionId);
        if (!proof || proof.taskRevision !== dependency.revision || proof.status !== 'completed' || proof.result?.disposition !== 'completed') return false;
      }
    }
    return true;
  }
  async getUnblockedTasks(completedId: string): Promise<TaskRecord[]> { const candidates = (await this.listTasks()).filter((x) => x.status === 'pending' && x.blockedBy.includes(completedId)); const checks = await Promise.all(candidates.map((x) => this.canStart(x.id))); return candidates.filter((_x, index) => checks[index]); }

  private async assertCanComplete(task: TaskRecord, result?: TaskCompletionResult): Promise<void> {
    if (!task.executionRequired) return;
    if (!task.currentExecutionId) throw new Error('Executable task cannot complete without an execution.');
    const execution = await this.requireExecution(task.currentExecutionId);
    if (!terminal(execution.status)) throw new Error('Task execution has not settled.');
    if (execution.taskRevision !== task.revision || execution.status !== 'completed' || execution.result?.disposition !== 'completed') {
      throw new Error('Task completion requires a completed execution result for the current task revision.');
    }
    if (result && JSON.stringify(result) !== JSON.stringify(execution.result)) {
      throw new Error('Task completion result cannot replace the execution owner result.');
    }
    const effective = execution.result;
    const missing = task.completionRequirements.filter((key) => !effective.outputs[key]);
    if (missing.length) throw new Error(`Task result is missing requirements: ${missing.join(', ')}`);
    await this.assertCompletionClosure(task, effective);
    if (this.options.validateResultRef && !await this.options.validateResultRef(task, effective)) throw new Error('Task result reference validation failed.');
  }
  private async assertCompletionClosure(task: TaskRecord, _result: TaskCompletionResult): Promise<void> { if (!await this.canStart(task.id)) throw new Error('Task dependencies are not completed with verified results.'); const children = (await this.listTasks()).filter((candidate) => candidate.parentTaskId === task.id); const unresolved = children.filter((child) => child.status !== 'completed' && child.status !== 'cancelled'); if (unresolved.length) throw new Error(`Task has unresolved child tasks: ${unresolved.map((child) => child.id).join(', ')}`); const unsuccessful = children.filter((child) => child.status === 'cancelled' || child.disposition !== 'completed'); if (unsuccessful.length) throw new Error('Parent task with partial, blocked, or cancelled child work cannot be completed.'); }
  private assertCurrent(task: TaskRecord, execution: TaskExecutionRecord, generation: number): void { if (execution.generation !== generation || task.currentExecutionId !== execution.id || execution.taskRevision !== task.revision) throw new Error('Stale task execution generation or revision.'); }
  private async updateLinks(task: TaskRecord, updates: UpdateTaskOptions): Promise<TaskRecord[]> { const changed = new Map<string, TaskRecord>(); const dependencies = dedupe(updates.addBlockedBy ?? []); await this.assertDependenciesExist(dependencies); await this.assertNoDependencyCycle(task.id, dependencies); for (const id of appendUnique(task.blockedBy, dependencies)) { const upstream = await this.requireTask(id); if (!upstream.blocks.includes(task.id)) { upstream.blocks.push(task.id); upstream.updatedAt = Date.now(); changed.set(upstream.id, upstream); } } for (const id of dedupe(updates.addBlocks ?? [])) { await this.assertDependenciesExist([id]); await this.assertNoDependencyCycle(id, [task.id]); const downstream = await this.requireTask(id); if (terminalTask(downstream.status)) throw new Error(`Cannot revise dependency graph for terminal task: ${downstream.id}`); if (downstream.currentExecutionId) { const active = await this.store.loadExecution(downstream.currentExecutionId); if (active && !terminal(active.status)) throw new Error(`Cannot revise dependency graph for active task: ${downstream.id}`); } if (appendUnique(task.blocks, [id]).length && !downstream.blockedBy.includes(task.id)) { downstream.blockedBy.push(task.id); downstream.revision += 1; downstream.updatedAt = Date.now(); changed.set(downstream.id, downstream); } } return [...changed.values()]; }
  private async assertDependenciesExist(ids: string[]): Promise<void> { for (const id of ids) if (!await this.store.loadTask(id)) throw new Error(`Task dependency not found: ${id}`); }
  private async assertNoDependencyCycle(taskId: string, dependencies: string[]): Promise<void> { for (const dependency of dependencies) { if (dependency === taskId) throw new Error('Task cannot depend on itself.'); if (await this.dependsOn(dependency, taskId)) throw new Error('Task dependency cycle detected.'); } }
  private async dependsOn(from: string, target: string): Promise<boolean> { const seen = new Set<string>(); const pending = [from]; while (pending.length) { const id = pending.pop()!; if (id === target) return true; if (seen.has(id)) continue; seen.add(id); const task = await this.store.loadTask(id); pending.push(...(task?.blockedBy ?? [])); } return false; }
  private async requireTask(id: string): Promise<TaskRecord> { const task = await this.store.loadTask(id); if (!task) throw new Error(`Task not found: ${id}`); return task; }
  private async requireExecution(id: string): Promise<TaskExecutionRecord> { const value = await this.store.loadExecution(id); if (!value) throw new Error(`Task execution not found: ${id}`); return value; }
  private async hasCancellingAncestor(taskId: string): Promise<boolean> { let current: string | undefined = taskId; while (current) { if (CANCELLING_TASK_TREES.has(current)) return true; current = (await this.store.loadTask(current))?.parentTaskId; } return false; }
  private async hasUnavailableAncestor(taskId: string): Promise<boolean> { let current: string | undefined = taskId; while (current) { const task = await this.store.loadTask(current); if (!task || terminalTask(task.status) || CANCELLING_TASK_TREES.has(current)) return true; if (task.currentExecutionId && (await this.store.loadExecution(task.currentExecutionId))?.status === 'cancelling') return true; current = task.parentTaskId; } return false; }
  private id(prefix: string, now: number): string { return `${prefix}_${now}_${crypto.randomBytes(4).toString('hex')}`; }
}

function validateResult(result: TaskCompletionResult, status: string): void { if (!result.summary.trim()) throw new Error('Execution result summary is required.'); if (Boolean(result.resultRef) !== Boolean(result.resultHash)) throw new Error('Execution result reference and hash must be provided together.'); const expected = status === 'failed' || status === 'interrupted' ? 'blocked' : status; if (result.disposition !== expected) throw new Error(`${status} execution requires ${expected} disposition.`); }
function sameSettlement(execution: TaskExecutionRecord, options: SettleTaskExecutionOptions): boolean { return execution.status === options.status && JSON.stringify(execution.result) === JSON.stringify(options.result); }
function terminal(status: TaskExecutionRecord['status']): boolean { return status === 'completed' || status === 'partial' || status === 'blocked' || status === 'failed' || status === 'cancelled' || status === 'interrupted'; }
function terminalTask(status: TaskStatus): boolean { return status === 'completed' || status === 'cancelled'; }
function dedupe(values: readonly string[]): string[] { return [...new Set(values.filter((x) => typeof x === 'string' && x.length > 0))]; }
function appendUnique(target: string[], incoming: readonly string[]): string[] { const added: string[] = []; for (const value of incoming) if (!target.includes(value)) { target.push(value); added.push(value); } return added; }
function collectDescendants(parentId: string, tasks: readonly TaskRecord[]): TaskRecord[] { const result: TaskRecord[] = []; const pending = [parentId]; while (pending.length) { const current = pending.pop()!; for (const task of tasks) if (task.parentTaskId === current && !result.some((entry) => entry.id === task.id)) { result.push(task); pending.push(task.id); } } return result; }

function inheritBudget(
  requested: StartTaskExecutionOptions['budget'],
  previous?: TaskExecutionRecord['budget'],
  parent?: TaskExecutionRecord['budget'],
): TaskExecutionRecord['budget'] {
  const sources = [requested, previous, parent].filter((value): value is NonNullable<typeof value> => Boolean(value));
  const minimum = (key: 'maxToolCalls' | 'maxSubagents' | 'maxChildDepth' | 'deadlineAt'): number | undefined => {
    const values = sources.map((source) => source[key]).filter((value): value is number => typeof value === 'number');
    return values.length ? Math.min(...values) : undefined;
  };
  const maximum = (key: 'toolCalls' | 'subagents' | 'childDepth'): number => {
    return Math.max(0, ...sources.map((source) => source[key] ?? 0));
  };
  return {
    maxToolCalls: minimum('maxToolCalls'),
    toolCalls: maximum('toolCalls'),
    maxSubagents: minimum('maxSubagents'),
    subagents: maximum('subagents'),
    maxChildDepth: minimum('maxChildDepth'),
    childDepth: maximum('childDepth'),
    deadlineAt: minimum('deadlineAt'),
    startedAt: Math.min(Date.now(), previous?.startedAt ?? Number.POSITIVE_INFINITY, parent?.startedAt ?? Number.POSITIVE_INFINITY),
  };
}

function validateBudget(budget: TaskExecutionRecord['budget']): void {
  const nonNegative = ['toolCalls', 'subagents', 'childDepth'] as const;
  const optionalNonNegative = ['maxToolCalls', 'maxSubagents', 'maxChildDepth'] as const;
  for (const key of nonNegative) if (!Number.isFinite(budget[key]) || budget[key] < 0) throw new Error(`Invalid task execution budget: ${key}.`);
  for (const key of optionalNonNegative) if (budget[key] !== undefined && (!Number.isFinite(budget[key]) || budget[key]! < 0)) throw new Error(`Invalid task execution budget: ${key}.`);
  if (budget.maxToolCalls !== undefined && budget.toolCalls > budget.maxToolCalls) throw new Error('Task execution tool-call budget is already exhausted.');
  if (budget.maxSubagents !== undefined && budget.subagents > budget.maxSubagents) throw new Error('Task execution subagent budget is already exhausted.');
  if (budget.maxChildDepth !== undefined && budget.childDepth > budget.maxChildDepth) throw new Error('Task execution child-depth budget is exceeded.');
  if (!Number.isFinite(budget.startedAt) || (budget.deadlineAt !== undefined && (!Number.isFinite(budget.deadlineAt) || budget.deadlineAt <= Date.now()))) throw new Error('Task execution deadline is invalid or expired.');
}

function validateRootBudget(budget: TaskRootBudgetRecord): void {
  const values = [budget.toolCalls, budget.subagents, budget.maxToolCalls, budget.maxSubagents,
    budget.maxChildDepth, budget.deadlineAt, budget.startedAt, budget.updatedAt];
  if (values.some((value) => !Number.isFinite(value) || value < 0)) throw new Error('Invalid root Task budget.');
  if (budget.toolCalls > budget.maxToolCalls || budget.subagents > budget.maxSubagents) {
    throw new Error('Root Task budget is exhausted.');
  }
}
