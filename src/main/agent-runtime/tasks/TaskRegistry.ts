import * as crypto from 'crypto';
import { FileTaskStore, type TaskStore } from './TaskStore';
import {
  TASK_SCHEMA_VERSION, type SettleTaskExecutionOptions, type StartTaskExecutionOptions,
  type TaskCompletionResult, type TaskExecutionMessage, type TaskExecutionRecord,
  type TaskMessageKind, type TaskRecord, type TaskRootBudgetRecord, type TaskStatus,
} from './TaskContracts';
import { cancelOwnedTaskExecution } from './TaskExecutionOwners';
import { projectTaskItems, type ProjectedTaskItem } from './taskProjection';
import { taskDependencyWait } from './taskDependencies';
import { TaskExecutionRequirementsSchema, TaskRuntimeEpochSchema, type TaskExecutionRequirements, type TaskExecutionPreparation, type TaskRuntimeEpoch, type PlanTaskRequirement } from '@shared/types/taskExecution';
import { assertApprovedTaskRequirement, assertTaskExecutionStart, assertTaskExecutionPreparation, assertTaskExecutionCompletion, assertIndependentReviewResult, readIndependentTaskSources, hashTaskRequirement, canReexecuteInvalidatedTask, canContinueReviewedSource, canContinueReviewWithNewSources } from './TaskExecutionRequirements';

const TASK_RUNTIME_INSTANCE_ID = crypto.randomUUID();
const CANCELLING_TASK_TREES = new Set<string>();
const INVALID_RESULT_REFERENCE = 'Task result reference validation failed: provide an accessible owning-session URI and exact hash for the result being reviewed. A supporting receipt is not the result unless it is the actual work product.';
export const INVALIDATED_REVIEW_GUIDANCE = 'To revise a reviewed result, reexecute the source Task with its unchanged definition (for direct work use task_update status=in_progress), settle it with the new resultRef and resultHash, then dispatch the same review Task with that current source; preserve consumption and deadlines.';
class TaskCompletionUnavailable extends Error {
  constructor(message: string) {
    super(message.startsWith('TASK_EXECUTION_REQUIREMENTS:') ? message : `TASK_EXECUTION_REQUIREMENTS: ${message}`);
  }
}
const isCompletionUnavailable = (error: unknown): error is Error => error instanceof TaskCompletionUnavailable
  || (error instanceof Error && error.message.startsWith('TASK_EXECUTION_REQUIREMENTS:'));

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
        const executionRequirements = input.executionRequirements === undefined ? undefined : TaskExecutionRequirementsSchema.parse(input.executionRequirements);
        if (executionRequirements && input.executionRequired === false) throw new Error('TASK_EXECUTION_REQUIREMENTS: constrained work requires an execution.');
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
        prepared.push({ schemaVersion: TASK_SCHEMA_VERSION, id, subject: input.subject.trim(), description: input.description ?? '', status: 'pending', owner: input.owner, parentTaskId: input.parentTaskId, blockedBy, blocks: [], completionRequirements: dedupe(input.completionRequirements ?? []), executionRequirements, executionRequired: input.executionRequired !== false, executionIds: [], revision: 1, metadata: input.metadata ? { ...input.metadata } : undefined, creationTurnRef: input.creationTurnRef, createdAt, updatedAt: createdAt });
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
      if (terminalTask(task.status) && next !== task.status) throw new Error(`Terminal task cannot transition from ${task.status} to ${next}.`);
      const semanticsChanged = updates.subject !== undefined || updates.description !== undefined || updates.completionRequirements !== undefined || updates.executionRequirements !== undefined || Boolean(updates.addBlockedBy?.length) || Boolean(updates.addBlocks?.length);
      if (terminalTask(task.status) && semanticsChanged) {
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
        if (active && !terminal(active.status)) throw new Error('Settle or cancel and join the active execution before returning its task to pending.');
      }
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
      if (updates.executionRequirements !== undefined) {
        if (!task.executionRequired) throw new Error('TASK_EXECUTION_REQUIREMENTS: constrained work requires an execution.');
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
      else if (terminalTask(task.status) && !continuation) {
        const guidance = task.status === 'completed' && task.executionRequirements?.independentOfTaskIds.length ? ` ${INVALIDATED_REVIEW_GUIDANCE}` : '';
        throw new Error(`Terminal task cannot start another execution: ${task.status}.${guidance}`);
      }
      if (task.status === 'in_progress') throw new Error('An in-progress task cannot start another execution. To delegate distinct work while this parent stays active, create a child Task with parentTaskId and dispatch that child. To retry the same Task, settle or cancel and join its current execution first; a delegated runner starts its own execution.');
      if (task.currentExecutionId) { const current = await this.store.loadExecution(task.currentExecutionId); if (current && !terminal(current.status)) throw new Error(`Task already has an active execution: ${current.id}. Settle or cancel and join it first; setting pending does not release it.`); }
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
      const execution: TaskExecutionRecord = { schemaVersion: TASK_SCHEMA_VERSION, id: this.id('execution', now), taskId, taskRevision: task.revision, generation, runtimeInstanceId: TASK_RUNTIME_INSTANCE_ID, parentExecutionId: options.parentExecutionId, rootBudgetId, mode: options.mode, status: 'running', budget, frozenPlanRef: options.frozenPlanRef, preparation: options.preparation ? structuredClone(options.preparation) : undefined, childMessageAckSequence: 0, parentMessageAckSequence: 0, createdAt: now, updatedAt: now };
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
        throw new Error('Task execution is already settled with a different terminal result. Inspect the Task with task_get; to continue useful work, start a new execution of the same Task with status=in_progress, preserving its consumption and deadline.');
      }
      if (execution.status === 'cancelling' && options.status !== 'cancelled') throw new Error('Task execution cancellation is in progress.');
      if (!terminal(options.status)) throw new Error('Execution status is not terminal.');
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

  async updateExecutionStatus(id: string, status: 'running' | 'waiting', expectedGeneration: number): Promise<TaskExecutionRecord> { await this.requireExecution(id); return this.store.withLock('state', async () => { const execution = await this.requireExecution(id); const task = await this.requireTask(execution.taskId); this.assertCurrent(task, execution, expectedGeneration); if (terminal(execution.status) || execution.status === 'cancelling') throw new Error('Settled or cancelling execution cannot return to a running state.'); execution.status = status; execution.updatedAt = Date.now(); await this.store.saveExecution(execution); return execution; }); }

  async bindExecutionPreparation(id: string, expectedGeneration: number, preparation: TaskExecutionPreparation): Promise<void> {
    await this.store.withLock('state', async () => {
      const execution = await this.requireExecution(id); const task = await this.requireTask(execution.taskId);
      this.assertCurrent(task, execution, expectedGeneration);
      if (terminal(execution.status) || execution.status === 'cancelling') throw new Error('Cannot prepare a settled or cancelling execution.');
      await this.assertApprovedRequirement(task);
      await assertTaskExecutionPreparation(task, execution.mode, preparation, this.store);
      if (execution.preparation && JSON.stringify(execution.preparation) !== JSON.stringify(preparation)) throw new Error('TASK_EXECUTION_REQUIREMENTS: execution preparation is immutable.');
      execution.preparation = structuredClone(preparation);
      const independentSources = await readIndependentTaskSources(task, this.store);
      if (execution.independentSources && JSON.stringify(execution.independentSources) !== JSON.stringify(independentSources)) throw new Error('TASK_EXECUTION_REQUIREMENTS: independent sources are immutable.');
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
          throw new Error('TASK_EXECUTION_REQUIREMENTS: invalid or unsigned runtime identity transition.');
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
      if (task.status !== 'completed') throw new Error(`TASK_EXECUTION_REQUIREMENTS: approved Task is not completed: ${task.id}`);
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
          if (task.revision !== snapshot.revision) throw new Error('TASK_PLAN_REVISION_CONFLICT: Task changed since plan submission.');
          continue;
        }
        if (task.revision === snapshot.revision) { assertApprovedTaskRequirement(task, [snapshot]); continue; }
        if (task.status === 'completed') throw new Error('TASK_PLAN_REVISION_CONFLICT: completed Tasks cannot be reopened.');
        const active = task.currentExecutionId ? await this.store.loadExecution(task.currentExecutionId) : null;
        if (active && !terminal(active.status)) throw new Error('TASK_PLAN_REVISION_CONFLICT: cancel and join before revising active work.');
        if (task.revision !== snapshot.replacesRevision || hashTaskRequirement(task) !== snapshot.previousRequirementHash) {
          throw new Error('TASK_PLAN_REVISION_CONFLICT: Task changed since the approved proposal was prepared.');
        }
        changed.push({ ...task, subject: snapshot.subject, description: snapshot.description,
          completionRequirements: [...snapshot.completionRequirements], executionRequirements: snapshot.executionRequirements,
          revision: snapshot.revision, updatedAt: Date.now() });
      }
      if (changed.length) await this.store.commit({ tasks: changed });
      for (const task of changed) await this.emitTaskChange('updated', task);
    });
  }

  private async assertApprovedRequirement(task: TaskRecord): Promise<void> {
    assertApprovedTaskRequirement(task, await this.store.readApprovedRequirements?.() ?? []);
  }
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
  /** Stop one owned child for replay recovery without turning its logical Task into a user cancellation. */
  async interruptExecutionForRecovery(id: string, expectedGeneration: number): Promise<void> {
    const initial = await this.requireExecution(id);
    if (CANCELLING_TASK_TREES.has(initial.taskId)) throw new Error('TASK_RECOVERY_INTERRUPT_BUSY');
    CANCELLING_TASK_TREES.add(initial.taskId);
    try {
      const intent = await this.store.withLock('state', async () => {
        const execution = await this.requireExecution(id); const task = await this.requireTask(execution.taskId);
        this.assertCurrent(task, execution, expectedGeneration);
        if (terminal(execution.status)) return null;
        if (execution.mode !== 'subagent' || execution.status === 'cancelling') throw new Error('TASK_RECOVERY_INTERRUPT_DENIED');
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
          if (execution.status !== 'cancelling') throw new Error('TASK_RECOVERY_INTERRUPT_CHANGED');
          execution.status = intent.previousStatus; task.statusReason = intent.previousReason;
          execution.updatedAt = task.updatedAt = Date.now();
          await this.store.commit({ tasks: [task], executions: [execution] }); await this.emitTaskChange('updated', task);
        });
        throw new Error('TASK_RECOVERY_INTERRUPT_OWNER_MISSING: child abort and join ownership is unavailable.');
      }
      await this.store.withLock('state', async () => {
        const execution = await this.requireExecution(id); const task = await this.requireTask(execution.taskId);
        this.assertCurrent(task, execution, expectedGeneration);
        if (execution.status !== 'cancelling') throw new Error('TASK_RECOVERY_INTERRUPT_CHANGED');
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
    this.onTaskChange({ type, task, snapshot: projectTaskItems(await this.currentTaskProjection(), await this.store.listExecutions()) });
  }
  async readConsistentSnapshot(): Promise<{ tasks: TaskRecord[]; executions: TaskExecutionRecord[] }> { return this.store.withLock('state', async () => ({ tasks: await this.currentTaskProjection(), executions: await this.store.listExecutions() })); }
  async deleteTask(id: string): Promise<void> { await this.store.withLock('state', async () => { const task = await this.requireTask(id); if (task.executionIds.length) throw new Error('Executed tasks retain their durable results and cannot be deleted.'); const related = (await this.store.listTasks()).filter((candidate) => candidate.id !== id && (candidate.blockedBy.includes(id) || candidate.blocks.includes(id) || candidate.parentTaskId === id)); if (related.some((candidate) => candidate.parentTaskId === id)) throw new Error('Cannot delete a task while child tasks still exist.'); for (const candidate of related) { if (candidate.currentExecutionId) { const active = await this.store.loadExecution(candidate.currentExecutionId); if (active && !terminal(active.status)) throw new Error(`Cannot revise graph for active task: ${candidate.id}`); } candidate.blockedBy = candidate.blockedBy.filter((entry) => entry !== id); candidate.blocks = candidate.blocks.filter((entry) => entry !== id); candidate.revision += 1; candidate.updatedAt = Date.now(); } await this.store.commit({ tasks: related, deletedTaskIds: [id] }); }); }
  async canStart(id: string): Promise<boolean> {
    const task = await this.store.loadTask(id);
    if (!task) return false;
    for (const dependencyId of task.blockedBy) {
      const dependency = await this.store.loadTask(dependencyId);
      const proof = dependency?.currentExecutionId ? await this.store.loadExecution(dependency.currentExecutionId) : undefined;
      if (taskDependencyWait(dependencyId, dependency, proof)) return false;
      if (dependency) {
        try { await this.assertCanComplete(dependency, undefined, new Set([task.id])); }
        catch (error) {
          if (isCompletionUnavailable(error)) return false;
          throw error;
        }
      }
    }
    return true;
  }
  async getUnblockedTasks(completedId: string): Promise<TaskRecord[]> { const candidates = (await this.listTasks()).filter((x) => x.status === 'pending' && x.blockedBy.includes(completedId)); const checks = await Promise.all(candidates.map((x) => this.canStart(x.id))); return candidates.filter((_x, index) => checks[index]); }

  private async assertCancelledContinuation(task: TaskRecord, options: StartTaskExecutionOptions): Promise<void> {
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
      if (CANCELLING_TASK_TREES.has(member.id)
        || (await this.store.listExecutions(member.id)).some(execution => !terminal(execution.status))) {
        throw new Error('Cancelled Task continuation must wait for every owned producer to join.');
      }
    }
  }

  private async assertCanComplete(task: TaskRecord, result?: TaskCompletionResult, visiting = new Set<string>()): Promise<void> {
    if (visiting.has(task.id)) throw new TaskCompletionUnavailable('TASK_EXECUTION_REQUIREMENTS: cyclic Task completion dependency.');
    visiting.add(task.id);
    try {
    await this.assertApprovedRequirement(task);
    if (!task.executionRequired) { await this.assertCompletionClosure(task, visiting); return; }
    if (!task.currentExecutionId) throw new TaskCompletionUnavailable('Executable task cannot complete without an execution.');
    const execution = await this.requireExecution(task.currentExecutionId);
    if (!terminal(execution.status)) throw new TaskCompletionUnavailable('Task execution has not settled.');
    if (execution.taskRevision !== task.revision || execution.status !== 'completed' || execution.result?.disposition !== 'completed') {
      throw new TaskCompletionUnavailable('Task completion requires a completed execution result for the current task revision.');
    }
    if (result && JSON.stringify(result) !== JSON.stringify(execution.result)) {
      if (await canReexecuteInvalidatedTask(task, this.store)) {
        throw new TaskCompletionUnavailable('Task completion result cannot replace the execution owner result; start a new execution and settle it with a verifiable resultRef and resultHash.');
      }
      throw new TaskCompletionUnavailable('Task completion result cannot replace the execution owner result.');
    }
    const effective = execution.result;
    await assertTaskExecutionCompletion(task, execution, this.store);
    await assertIndependentReviewResult(task, effective, this.store);
    const missing = task.completionRequirements.filter((key) => !effective.outputs[key]);
    if (missing.length) throw new TaskCompletionUnavailable(`Task result is missing requirements: ${missing.join(', ')}`);
    await this.assertCompletionClosure(task, visiting);
    if (this.options.validateResultRef && !await this.options.validateResultRef(task, effective)) throw new TaskCompletionUnavailable(INVALID_RESULT_REFERENCE);
    } finally { visiting.delete(task.id); }
  }
  private async assertCompletionClosure(task: TaskRecord, visiting = new Set([task.id])): Promise<void> {
    for (const id of task.blockedBy) {
      const dependency = await this.store.loadTask(id);
      const proof = dependency?.currentExecutionId ? await this.store.loadExecution(dependency.currentExecutionId) : undefined;
      if (taskDependencyWait(id, dependency, proof)) throw new TaskCompletionUnavailable('Task dependencies are not completed with verified results.');
      if (dependency) await this.assertCanComplete(dependency, undefined, visiting);
    }
    const children = (await this.store.listTasks()).filter(candidate => candidate.parentTaskId === task.id);
    const unresolved = children.filter(child => child.status !== 'completed' && child.status !== 'cancelled');
    if (unresolved.length) throw new TaskCompletionUnavailable(`Task has unresolved child tasks: ${unresolved.map(child => child.id).join(', ')}`);
    if (children.some(child => child.status === 'cancelled' || child.disposition !== 'completed')) {
      throw new TaskCompletionUnavailable('Parent task with partial, blocked, or cancelled child work cannot be completed.');
    }
    for (const child of children) await this.assertCanComplete(child, undefined, visiting);
  }
  private async currentTaskProjection(): Promise<TaskRecord[]> {
    const tasks = await this.store.listTasks();
    return Promise.all(tasks.map(async task => {
      if (task.status !== 'completed') return task;
      try { await this.assertCanComplete(task); return task; }
      catch (error) {
        if (!isCompletionUnavailable(error)) throw error;
        return { ...task, status: 'blocked' as const, statusReason: `Completion requires revalidation: ${error.message}` };
      }
    }));
  }
  private async canContinueInvalidatedTask(task: TaskRecord): Promise<boolean> {
    if (await canReexecuteInvalidatedTask(task, this.store)) return true;
    if (task.status !== 'blocked') return false;
    const executions = await this.store.listExecutions(task.id);
    const previous = executions.filter(execution => execution.status === 'completed').at(-1);
    return previous ? canReexecuteInvalidatedTask({ ...task, status: 'completed', currentExecutionId: previous.id }, this.store) : false;
  }
  private assertCurrent(task: TaskRecord, execution: TaskExecutionRecord, generation: number): void { if (execution.generation !== generation || task.currentExecutionId !== execution.id || execution.taskRevision !== task.revision) throw new Error('Stale task execution generation or revision.'); }
  private async updateLinks(task: TaskRecord, updates: UpdateTaskOptions): Promise<TaskRecord[]> { const changed = new Map<string, TaskRecord>(); const dependencies = dedupe(updates.addBlockedBy ?? []); await this.assertDependenciesExist(dependencies); await this.assertNoDependencyCycle(task.id, dependencies); for (const id of appendUnique(task.blockedBy, dependencies)) { const upstream = await this.requireTask(id); if (!upstream.blocks.includes(task.id)) { upstream.blocks.push(task.id); upstream.updatedAt = Date.now(); changed.set(upstream.id, upstream); } } for (const id of dedupe(updates.addBlocks ?? [])) { await this.assertDependenciesExist([id]); await this.assertNoDependencyCycle(id, [task.id]); const downstream = await this.requireTask(id); if (terminalTask(downstream.status)) throw new Error(`Cannot revise dependency graph for terminal task: ${downstream.id}`); if (downstream.currentExecutionId) { const active = await this.store.loadExecution(downstream.currentExecutionId); if (active && !terminal(active.status)) throw new Error(`Cannot revise dependency graph for active task: ${downstream.id}`); } if (appendUnique(task.blocks, [id]).length && !downstream.blockedBy.includes(task.id)) { downstream.blockedBy.push(task.id); downstream.revision += 1; downstream.updatedAt = Date.now(); changed.set(downstream.id, downstream); } } return [...changed.values()]; }
  private async assertDependenciesExist(ids: string[]): Promise<void> { for (const id of ids) if (!await this.store.loadTask(id)) throw new Error(`Task dependency not found: ${id}`); }
  private async assertNoDependencyCycle(taskId: string, dependencies: string[]): Promise<void> { for (const dependency of dependencies) { if (dependency === taskId) throw new Error('Task cannot depend on itself.'); if (await this.dependsOn(dependency, taskId)) throw new Error('Task dependency cycle detected.'); } }
  private async dependsOn(from: string, target: string): Promise<boolean> { const seen = new Set<string>(); const pending = [from]; while (pending.length) { const id = pending.pop()!; if (id === target) return true; if (seen.has(id)) continue; seen.add(id); const task = await this.store.loadTask(id); pending.push(...(task?.blockedBy ?? [])); } return false; }
  private async requireTask(id: string): Promise<TaskRecord> { const task = await this.store.loadTask(id); if (!task) throw new Error(`Task not found: ${id}`); return task; }
  private async requireExecution(id: string): Promise<TaskExecutionRecord> { const value = await this.store.loadExecution(id); if (!value) throw new Error(`Task execution not found: ${id}`); return value; }
  private async hasCancellingAncestor(taskId: string): Promise<boolean> { let current: string | undefined = taskId; while (current) { if (CANCELLING_TASK_TREES.has(current)) return true; current = (await this.store.loadTask(current))?.parentTaskId; } return false; }
  private async hasUnavailableAncestor(taskId: string, allowCompleted = false): Promise<boolean> { let current: string | undefined = taskId; while (current) { const task = await this.store.loadTask(current); if (!task || task.status === 'cancelled' || (task.status === 'completed' && !allowCompleted) || CANCELLING_TASK_TREES.has(current)) return true; if (task.currentExecutionId && (await this.store.loadExecution(task.currentExecutionId))?.status === 'cancelling') return true; current = task.parentTaskId; } return false; }
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
    // The parent has its own local ledger. Only retries of this Task may carry
    // local consumption forward; the shared root ledger accounts for ancestors.
    return Math.max(0, requested?.[key] ?? 0, previous?.[key] ?? 0);
  };
  return {
    maxToolCalls: minimum('maxToolCalls'),
    toolCalls: maximum('toolCalls'),
    maxSubagents: minimum('maxSubagents'),
    subagents: maximum('subagents'),
    maxChildDepth: minimum('maxChildDepth'),
    childDepth: maximum('childDepth'),
    deadlineAt: minimum('deadlineAt'),
    startedAt: Math.min(Date.now(), previous?.startedAt ?? Number.POSITIVE_INFINITY),
  };
}

function validateBudget(budget: TaskExecutionRecord['budget'], requireRemainingTime = false): void {
  const nonNegative = ['toolCalls', 'subagents', 'childDepth'] as const;
  const optionalNonNegative = ['maxToolCalls', 'maxSubagents', 'maxChildDepth'] as const;
  for (const key of nonNegative) if (!Number.isFinite(budget[key]) || budget[key] < 0) throw new Error(`Invalid task execution budget: ${key}.`);
  for (const key of optionalNonNegative) if (budget[key] !== undefined && (!Number.isFinite(budget[key]) || budget[key]! < 0)) throw new Error(`Invalid task execution budget: ${key}.`);
  if (budget.maxToolCalls !== undefined && budget.toolCalls > budget.maxToolCalls) throw new Error(`Task execution tool-call budget is already exhausted. consumed=${budget.toolCalls}; cumulativeMax=${budget.maxToolCalls}. This cap includes prior Task generations, not additional allowance; preserve consumption, existing ceilings and deadline when checking a corrected request.`);
  if (budget.maxSubagents !== undefined && budget.subagents > budget.maxSubagents) throw new Error(`Task execution subagent budget is already exhausted. consumed=${budget.subagents}; cumulativeMax=${budget.maxSubagents}. This cap includes prior Task generations, not additional allowance; preserve consumption, existing ceilings and deadline when checking a corrected request.`);
  if (budget.maxChildDepth !== undefined && budget.childDepth > budget.maxChildDepth) throw new Error('Task execution child-depth budget is exceeded.');
  if (!Number.isFinite(budget.startedAt) || (budget.deadlineAt !== undefined && (!Number.isFinite(budget.deadlineAt) || budget.deadlineAt < 0))) throw new Error('Task execution deadline is invalid.');
  // A running execution may report its final usage after its deadline. The
  // deadline still bars starting a new execution, but must not prevent the
  // expired execution from recording consumption and settling its result.
  if (requireRemainingTime && budget.deadlineAt !== undefined && budget.deadlineAt <= Date.now()) throw new Error('Task execution deadline is expired.');
}

function validateRootBudget(budget: TaskRootBudgetRecord): void {
  const values = [budget.toolCalls, budget.subagents, budget.maxToolCalls, budget.maxSubagents,
    budget.maxChildDepth, budget.deadlineAt, budget.startedAt, budget.updatedAt];
  if (values.some((value) => !Number.isFinite(value) || value < 0)) throw new Error('Invalid root Task budget.');
  if (budget.toolCalls > budget.maxToolCalls || budget.subagents > budget.maxSubagents) {
    throw new Error('Root Task budget is exhausted.');
  }
}
