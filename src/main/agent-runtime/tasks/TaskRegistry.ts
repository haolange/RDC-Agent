import * as crypto from 'crypto';
import { TaskExecutionRequirementsSchema, TaskRuntimeEpochSchema, type TaskExecutionRequirements, type TaskExecutionPreparation, type TaskRuntimeEpoch, type PlanTaskRequirement } from '@shared/types/taskExecution';
import { AppError } from '@shared/errors/appError';
import {
  TASK_SCHEMA_VERSION, type SettleTaskExecutionOptions, type StartTaskExecutionOptions,
  type TaskCompletionResult, type TaskExecutionRecord, type TaskRecord, type TaskStatus,
} from './TaskContracts';
import { cancelOwnedTaskExecution } from './TaskExecutionOwners';
import { assertApprovedTaskRequirement, assertTaskExecutionStart, assertTaskExecutionPreparation, assertTaskExecutionCompletion, assertIndependentReviewResult, readIndependentTaskSources, hashTaskRequirement, canContinueReviewedSource, canContinueReviewWithNewSources } from './TaskExecutionRequirements';
import { CANCELLING_TASK_TREES, INVALID_RESULT_REFERENCE } from './TaskRegistryCore';
import { TaskExecutionLedger } from './TaskExecutionLedger';
import { collectDescendants, dedupeIds, inheritBudget, isTerminalExecutionStatus, isTerminalTaskStatus, sameSettlement, validateBudget, validateResult } from './taskRegistryRules';

const TASK_RUNTIME_INSTANCE_ID = crypto.randomUUID();
export const INVALIDATED_REVIEW_GUIDANCE = 'To revise a reviewed result, reexecute the source Task with its unchanged definition (for direct work use task_update status=in_progress), settle it with the new resultRef and resultHash, then dispatch the same review Task with that current source; preserve consumption and deadlines.';

export type { TaskCompletionResult, TaskExecutionMessage, TaskExecutionRecord, TaskRecord, TaskStatus } from './TaskContracts';

export interface CreateTaskOptions {
  description?: string; blockedBy?: string[]; owner?: string; parentTaskId?: string;
  completionRequirements?: string[]; executionRequired?: boolean; metadata?: Record<string, unknown>;
  executionRequirements?: TaskExecutionRequirements;
  creationTurnRef?: string;
}
export interface UpdateTaskOptions {
  status?: TaskStatus; statusReason?: string; subject?: string; description?: string; owner?: string;
  addBlockedBy?: string[]; addBlocks?: string[]; completionRequirements?: string[]; metadata?: Record<string, unknown>;
  result?: TaskCompletionResult;
  executionRequirements?: TaskExecutionRequirements;
}

/** The Task registry's lifecycle mutations: tasks, executions, approved revisions, cancellation and recovery. */
export class TaskRegistry extends TaskExecutionLedger {
  async createTask(subject: string, options: CreateTaskOptions = {}): Promise<TaskRecord> { return (await this.createTasks([{ subject, ...options }]))[0]!; }
  async createTasks(inputs: ReadonlyArray<{ subject: string } & CreateTaskOptions>): Promise<TaskRecord[]> {
    if (!inputs.length) throw new Error('At least one task is required.');
    return this.store.withLock('state', async () => {
      const prepared: TaskRecord[] = []; const base = Date.now();
      for (const [index, input] of inputs.entries()) {
        if (!input.subject.trim()) throw new Error('Task subject is required.');
        const createdAt = base + index; const id = this.id('task', createdAt); const blockedBy = dedupeIds(input.blockedBy ?? []);
        const executionRequirements = input.executionRequirements === undefined ? undefined : TaskExecutionRequirementsSchema.parse(input.executionRequirements);
        if (executionRequirements && input.executionRequired === false) throw new AppError('TASK_EXECUTION_REQUIREMENTS', 'constrained work requires an execution.');
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
        prepared.push({ schemaVersion: TASK_SCHEMA_VERSION, id, subject: input.subject.trim(), description: input.description ?? '', status: 'pending', owner: input.owner, parentTaskId: input.parentTaskId, blockedBy, blocks: [], completionRequirements: dedupeIds(input.completionRequirements ?? []), executionRequirements, executionRequired: input.executionRequired !== false, executionIds: [], revision: 1, metadata: input.metadata ? { ...input.metadata } : undefined, creationTurnRef: input.creationTurnRef, createdAt, updatedAt: createdAt });
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
    if (updates.result && updates.status !== 'completed') {
      throw new Error('Task execution results must be settled by their execution owner; a Task update cannot replace an execution result.');
    }
    if (updates.status === 'cancelled') return this.cancelTask(taskId, updates.statusReason);
    return this.store.withLock('state', async () => {
      const task = await this.requireTask(taskId); const next = updates.status ?? task.status;
      if (isTerminalTaskStatus(task.status) && next !== task.status) throw new Error(`Terminal task cannot transition from ${task.status} to ${next}.`);
      const semanticsChanged = updates.subject !== undefined || updates.description !== undefined || updates.completionRequirements !== undefined || updates.executionRequirements !== undefined || Boolean(updates.addBlockedBy?.length) || Boolean(updates.addBlocks?.length);
      if (isTerminalTaskStatus(task.status) && semanticsChanged) {
        if (task.status === 'completed') {
          throw new Error(`Completed Task definitions cannot change. ${INVALIDATED_REVIEW_GUIDANCE}`);
        }
        throw new Error('Cancelled Task definitions cannot change; explicitly resume the same Task only in a later user-requested turn.');
      }
      if (next === 'blocked' && !(updates.statusReason ?? task.statusReason)?.trim()) throw new Error('Blocked tasks require a statusReason.');
      if (next === 'in_progress' && !await this.canStart(taskId)) throw new Error('Task dependencies are not completed with verified results.');
      if (next === 'in_progress' && task.executionRequired && !task.currentExecutionId) throw new Error('Executable tasks must be started through startExecution.');
      if (next === 'pending' && task.currentExecutionId) {
        const active = await this.store.loadExecution(task.currentExecutionId);
        if (active && !isTerminalExecutionStatus(active.status)) throw new Error('Settle or cancel and join the active execution before returning its task to pending.');
      }
      if (next === 'blocked' && task.currentExecutionId) { const active = await this.store.loadExecution(task.currentExecutionId); if (active && !isTerminalExecutionStatus(active.status)) throw new Error('Settle or cancel the active execution before blocking its task.'); }
      if (next === 'completed') await this.assertCanComplete(task, updates.result);
      if (semanticsChanged && task.currentExecutionId) {
        const active = await this.store.loadExecution(task.currentExecutionId);
        if (active && !isTerminalExecutionStatus(active.status)) throw new Error('Cancel and join the current execution before revising its task.');
      }
      const relatedTasks = updates.addBlockedBy?.length || updates.addBlocks?.length ? await this.updateLinks(task, updates) : [];
      if (updates.subject !== undefined) task.subject = updates.subject.trim();
      if (updates.description !== undefined) task.description = updates.description;
      if (updates.owner !== undefined) task.owner = updates.owner;
      if (updates.completionRequirements !== undefined) task.completionRequirements = dedupeIds(updates.completionRequirements);
      if (updates.executionRequirements !== undefined) {
        if (!task.executionRequired) throw new AppError('TASK_EXECUTION_REQUIREMENTS', 'constrained work requires an execution.');
        task.executionRequirements = TaskExecutionRequirementsSchema.parse(updates.executionRequirements);
      }
      if (updates.metadata !== undefined) task.metadata = { ...(task.metadata ?? {}), ...updates.metadata };
      task.status = next; task.statusReason = updates.statusReason ?? (next === 'blocked' ? task.statusReason : undefined);
      task.disposition = updates.result?.disposition ?? (next === 'cancelled' ? 'cancelled' : next === 'blocked' ? 'blocked' : task.disposition);
      if (semanticsChanged) task.revision += 1; task.updatedAt = Date.now();
      await this.assertApprovedRequirement(task);
      await this.store.commit({ tasks: [task, ...relatedTasks] });
      await this.emitTaskChange('updated', task); return task;
    });
  }
  async startExecution(taskId: string, options: StartTaskExecutionOptions): Promise<TaskExecutionRecord> {
    return this.store.withLock('state', async () => {
      const task = await this.requireTask(taskId);
      const continuation = await this.canContinueInvalidatedTask(task) || await canContinueReviewedSource(task, this.store)
        || await canContinueReviewWithNewSources(task, options, this.store);
      if (task.parentTaskId && await this.hasUnavailableAncestor(task.parentTaskId, continuation)) throw new Error('Task ancestor is terminal or cancelling.');
      if (await this.hasCancellingAncestor(taskId)) throw new Error('Task or ancestor cancellation is in progress.');
      if (!await this.canStart(taskId)) throw new Error('Task dependencies are not completed with verified results.');
      await this.assertApprovedRequirement(task);
      await assertTaskExecutionStart(task, options, this.store);
      if (options.resumeCancelled) await this.assertCancelledContinuation(task, options);
      else if (isTerminalTaskStatus(task.status) && !continuation) {
        const guidance = task.status === 'completed' && task.executionRequirements?.independentOfTaskIds.length ? ` ${INVALIDATED_REVIEW_GUIDANCE}` : '';
        throw new Error(`Terminal task cannot start another execution: ${task.status}.${guidance}`);
      }
      if (task.status === 'in_progress') throw new Error('An in-progress task cannot start another execution. To delegate distinct work while this parent stays active, create a child Task with parentTaskId and dispatch that child. To retry the same Task, settle or cancel and join its current execution first; a delegated runner starts its own execution.');
      if (task.currentExecutionId) { const current = await this.store.loadExecution(task.currentExecutionId); if (current && !isTerminalExecutionStatus(current.status)) throw new Error(`Task already has an active execution: ${current.id}. Settle or cancel and join it first; setting pending does not release it.`); }
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
      validateBudget(budget, true);
      const now = Date.now();
      const execution: TaskExecutionRecord = { schemaVersion: TASK_SCHEMA_VERSION, id: this.id('execution', now), taskId, taskRevision: task.revision, generation, runtimeInstanceId: TASK_RUNTIME_INSTANCE_ID, parentExecutionId: options.parentExecutionId, rootBudgetId, mode: options.mode, ...(options.dispatch ? { dispatch: options.dispatch } : {}), status: 'running', budget, frozenPlanRef: options.frozenPlanRef, preparation: options.preparation ? structuredClone(options.preparation) : undefined, childMessageAckSequence: 0, parentMessageAckSequence: 0, createdAt: now, updatedAt: now };
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
      if (isTerminalExecutionStatus(execution.status)) {
        if (sameSettlement(execution, options)) return execution;
        throw new Error('Task execution is already settled with a different terminal result. Inspect the Task with task_get; to continue useful work, start a new execution of the same Task with status=in_progress, preserving its consumption and deadline.');
      }
      if (execution.status === 'cancelling' && options.status !== 'cancelled') throw new Error('Task execution cancellation is in progress.');
      if (!isTerminalExecutionStatus(options.status)) throw new Error('Execution status is not terminal.');
      validateResult(options.result, options.status);
      if (this.options.validateResultRef && !await this.options.validateResultRef(task, options.result)) throw new Error(INVALID_RESULT_REFERENCE);
      const missing = task.completionRequirements.filter((key) => !options.result.outputs[key]);
      if (options.result.disposition === 'completed' && missing.length) throw new Error(`Task result is missing requirements: ${missing.join(', ')}`);
      if (options.result.disposition === 'completed' && options.result.missingRequirements?.length) {
        throw new Error('Completed task result cannot declare missing requirements.');
      }
      if (options.result.disposition === 'completed') {
        await this.assertApprovedRequirement(task);
        await assertTaskExecutionCompletion(task, execution, this.store);
        await assertIndependentReviewResult(task, options.result, this.store);
        await this.assertCompletionClosure(task);
      }
      execution.status = options.status; execution.result = options.result; execution.updatedAt = Date.now(); execution.settledAt = execution.updatedAt;
      task.status = options.result.disposition === 'completed' ? 'completed' : options.result.disposition === 'cancelled' ? 'cancelled' : 'blocked';
      task.disposition = options.result.disposition; task.statusReason = options.result.disposition === 'completed' ? undefined : options.result.summary; task.updatedAt = execution.updatedAt;
      await this.store.commit({ tasks: [task], executions: [execution] });
      await this.emitTaskChange('updated', task); return execution;
    });
  }
  async updateExecutionStatus(id: string, status: 'running' | 'waiting', expectedGeneration: number): Promise<TaskExecutionRecord> { await this.requireExecution(id); return this.store.withLock('state', async () => { const execution = await this.requireExecution(id); const task = await this.requireTask(execution.taskId); this.assertCurrent(task, execution, expectedGeneration); if (isTerminalExecutionStatus(execution.status) || execution.status === 'cancelling') throw new Error('Settled or cancelling execution cannot return to a running state.'); execution.status = status; execution.updatedAt = Date.now(); await this.store.saveExecution(execution); return execution; }); }
  async bindExecutionPreparation(id: string, expectedGeneration: number, preparation: TaskExecutionPreparation): Promise<void> {
    await this.store.withLock('state', async () => {
      const execution = await this.requireExecution(id); const task = await this.requireTask(execution.taskId);
      this.assertCurrent(task, execution, expectedGeneration);
      if (isTerminalExecutionStatus(execution.status) || execution.status === 'cancelling') throw new Error('Cannot prepare a settled or cancelling execution.');
      await this.assertApprovedRequirement(task);
      await assertTaskExecutionPreparation(task, execution.mode, preparation, this.store);
      if (execution.preparation && JSON.stringify(execution.preparation) !== JSON.stringify(preparation)) throw new AppError('TASK_EXECUTION_REQUIREMENTS', 'execution preparation is immutable.');
      execution.preparation = structuredClone(preparation);
      const independentSources = await readIndependentTaskSources(task, this.store);
      if (execution.independentSources && JSON.stringify(execution.independentSources) !== JSON.stringify(independentSources)) throw new AppError('TASK_EXECUTION_REQUIREMENTS', 'independent sources are immutable.');
      if (independentSources.length) execution.independentSources = independentSources;
      await this.store.saveExecution(execution);
    });
  }
  /** Append a host-signed identity transition to all direct executions owned by this turn. */
  async appendRuntimeEpochForTurn(turnId: string, generation: number, input: TaskRuntimeEpoch): Promise<number> {
    const epoch = TaskRuntimeEpochSchema.parse(input);
    const turnRef = `turn:${turnId}:generation:${generation}`;
    return this.store.withLock('state', async () => {
      const executions = (await this.store.listExecutions()).filter(execution => execution.mode === 'direct'
        && execution.frozenPlanRef === turnRef && (execution.status === 'running' || execution.status === 'waiting'));
      const changed: TaskExecutionRecord[] = [];
      for (const execution of executions) {
        const task = await this.requireTask(execution.taskId);
        this.assertCurrent(task, execution, execution.generation);
        const previous = execution.runtimeEpochs?.at(-1);
        if (previous && JSON.stringify(previous) === JSON.stringify(epoch)) continue;
        if (!execution.preparation || execution.preparation.turnId !== turnId
          || (previous?.runtimeFingerprint ?? execution.preparation.runtimeFingerprint) !== epoch.previousFingerprint
          || epoch.previousFingerprint === epoch.runtimeFingerprint || !this.store.verifyRuntimeEpoch
          || !await this.store.verifyRuntimeEpoch(epoch, execution.preparation)) {
          throw new AppError('TASK_EXECUTION_REQUIREMENTS', 'invalid or unsigned runtime identity transition.');
        }
        execution.runtimeEpochs = [...(execution.runtimeEpochs ?? []), epoch];
        execution.updatedAt = Date.now();
        changed.push(execution);
      }
      if (changed.length) await this.store.commit({ executions: changed });
      return changed.length;
    });
  }
  async assertApprovedTasksCompleted(): Promise<void> {
    for (const snapshot of await this.store.readApprovedRequirements?.() ?? []) {
      const task = await this.requireTask(snapshot.taskId);
      await this.assertApprovedRequirement(task);
      if (task.status !== 'completed') throw new AppError('TASK_EXECUTION_REQUIREMENTS', `approved Task is not completed: ${task.id}`);
      await this.assertCanComplete(task);
    }
  }
  /** Install only a user-approved, hash-bound proposal. Does not start or reset an execution. */
  async installApprovedTaskRevisions(snapshots: readonly PlanTaskRequirement[]): Promise<void> {
    await this.store.withLock('state', async () => {
      const changed: TaskRecord[] = [];
      for (const snapshot of snapshots) {
        const task = await this.requireTask(snapshot.taskId);
        if (snapshot.replacesRevision === undefined) {
          assertApprovedTaskRequirement(task, [snapshot]);
          if (task.revision !== snapshot.revision) throw new AppError('TASK_PLAN_REVISION_CONFLICT', 'Task changed since plan submission.');
          continue;
        }
        if (task.revision === snapshot.revision) { assertApprovedTaskRequirement(task, [snapshot]); continue; }
        if (task.status === 'completed') throw new AppError('TASK_PLAN_REVISION_CONFLICT', 'completed Tasks cannot be reopened.');
        const active = task.currentExecutionId ? await this.store.loadExecution(task.currentExecutionId) : null;
        if (active && !isTerminalExecutionStatus(active.status)) throw new AppError('TASK_PLAN_REVISION_CONFLICT', 'cancel and join before revising active work.');
        if (task.revision !== snapshot.replacesRevision || hashTaskRequirement(task) !== snapshot.previousRequirementHash) {
          throw new AppError('TASK_PLAN_REVISION_CONFLICT', 'Task changed since the approved proposal was prepared.');
        }
        changed.push({ ...task, subject: snapshot.subject, description: snapshot.description,
          completionRequirements: [...snapshot.completionRequirements], executionRequirements: snapshot.executionRequirements,
          revision: snapshot.revision, updatedAt: Date.now() });
      }
      if (changed.length) await this.store.commit({ tasks: changed });
      for (const task of changed) await this.emitTaskChange('updated', task);
    });
  }
  async reconcileInterruptedExecutions(): Promise<TaskExecutionRecord[]> {
    return this.store.withLock('state', async () => {
      const active = (await this.store.listExecutions()).filter((execution) => !isTerminalExecutionStatus(execution.status) && execution.runtimeInstanceId !== TASK_RUNTIME_INSTANCE_ID);
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
  /** Stop one owned child for replay recovery without turning its logical Task into a user cancellation. */
  async interruptExecutionForRecovery(id: string, expectedGeneration: number): Promise<void> {
    const initial = await this.requireExecution(id);
    if (CANCELLING_TASK_TREES.has(initial.taskId)) throw new AppError('TASK_RECOVERY_INTERRUPT_BUSY');
    CANCELLING_TASK_TREES.add(initial.taskId);
    try {
      const intent = await this.store.withLock('state', async () => {
        const execution = await this.requireExecution(id); const task = await this.requireTask(execution.taskId);
        this.assertCurrent(task, execution, expectedGeneration);
        if (isTerminalExecutionStatus(execution.status)) return null;
        if (execution.mode !== 'subagent' || execution.status === 'cancelling') throw new AppError('TASK_RECOVERY_INTERRUPT_DENIED');
        const previousStatus = execution.status; const previousReason = task.statusReason;
        execution.status = 'cancelling'; execution.updatedAt = Date.now();
        task.statusReason = 'Stopping the affected child before replay recovery.'; task.updatedAt = execution.updatedAt;
        await this.store.commit({ tasks: [task], executions: [execution] }); await this.emitTaskChange('updated', task);
        return { execution, previousStatus, previousReason };
      });
      if (!intent) return;
      const owned = this.options.onCancelExecution
        ? (await this.options.onCancelExecution(intent.execution), true) : await cancelOwnedTaskExecution(intent.execution);
      if (!owned) {
        await this.store.withLock('state', async () => {
          const execution = await this.requireExecution(id); const task = await this.requireTask(execution.taskId);
          this.assertCurrent(task, execution, expectedGeneration);
          if (execution.status !== 'cancelling') throw new AppError('TASK_RECOVERY_INTERRUPT_CHANGED');
          execution.status = intent.previousStatus; task.statusReason = intent.previousReason;
          execution.updatedAt = task.updatedAt = Date.now();
          await this.store.commit({ tasks: [task], executions: [execution] }); await this.emitTaskChange('updated', task);
        });
        throw new AppError('TASK_RECOVERY_INTERRUPT_OWNER_MISSING', 'child abort and join ownership is unavailable.');
      }
      await this.store.withLock('state', async () => {
        const execution = await this.requireExecution(id); const task = await this.requireTask(execution.taskId);
        this.assertCurrent(task, execution, expectedGeneration);
        if (execution.status !== 'cancelling') throw new AppError('TASK_RECOVERY_INTERRUPT_CHANGED');
        const summary = 'Child execution interrupted and joined for replay recovery; retry this Task with the remaining budget.';
        execution.status = 'interrupted'; execution.result = { disposition: 'blocked', summary, outputs: {} };
        execution.updatedAt = task.updatedAt = Date.now(); execution.settledAt = execution.updatedAt;
        task.status = 'blocked'; task.disposition = 'blocked'; task.statusReason = summary;
        await this.store.commit({ tasks: [task], executions: [execution] }); await this.emitTaskChange('updated', task);
      });
    } finally { CANCELLING_TASK_TREES.delete(initial.taskId); }
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
        if (!isTerminalTaskStatus(descendant.status)) await this.cancelSingleTask(descendant.id, `Cancelled with parent task ${taskId}.`);
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
      if (isTerminalExecutionStatus(execution.status)) {
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
  async deleteTask(id: string): Promise<void> { await this.store.withLock('state', async () => { const task = await this.requireTask(id); if (task.executionIds.length) throw new Error('Executed tasks retain their durable results and cannot be deleted.'); const related = (await this.store.listTasks()).filter((candidate) => candidate.id !== id && (candidate.blockedBy.includes(id) || candidate.blocks.includes(id) || candidate.parentTaskId === id)); if (related.some((candidate) => candidate.parentTaskId === id)) throw new Error('Cannot delete a task while child tasks still exist.'); for (const candidate of related) { if (candidate.currentExecutionId) { const active = await this.store.loadExecution(candidate.currentExecutionId); if (active && !isTerminalExecutionStatus(active.status)) throw new Error(`Cannot revise graph for active task: ${candidate.id}`); } candidate.blockedBy = candidate.blockedBy.filter((entry) => entry !== id); candidate.blocks = candidate.blocks.filter((entry) => entry !== id); candidate.revision += 1; candidate.updatedAt = Date.now(); } await this.store.commit({ tasks: related, deletedTaskIds: [id] }); }); }
}
