import {
  TaskExecutionPreparationSchema, TaskExecutionRequirementsSchema, PlanTaskRevisionSchema,
  type PlanTaskRequirement, type TaskExecutionPreparation, type TaskIndependentSource,
} from '@shared/types/taskExecution';
import type { StartTaskExecutionOptions, TaskExecutionRecord, TaskRecord } from './TaskContracts';
import type { TaskStore } from './TaskStore';
import { createHash } from 'node:crypto';

const denied = (message: string): never => { throw new Error(`TASK_EXECUTION_REQUIREMENTS: ${message}`); };

export function assertApprovedTaskRequirement(task: TaskRecord, approved: readonly PlanTaskRequirement[]): void {
  const snapshot = approved.find(item => item.taskId === task.id);
  if (!snapshot) return;
  if (task.subject !== snapshot.subject || task.description !== snapshot.description
    || JSON.stringify(task.completionRequirements) !== JSON.stringify(snapshot.completionRequirements)
    || JSON.stringify(task.executionRequirements) !== JSON.stringify(snapshot.executionRequirements)
    || snapshot.blockedBy.some(id => !task.blockedBy.includes(id))) {
    denied('Task differs from its approved plan obligation; revise and approve the plan before changing it.');
  }
}

export async function assertTaskExecutionStart(task: TaskRecord, options: StartTaskExecutionOptions, store: TaskStore): Promise<void> {
  const requirement = task.executionRequirements;
  if (!requirement) return;
  TaskExecutionRequirementsSchema.parse(requirement);
  if (requirement.mode !== options.mode) denied(`Task requires ${requirement.mode}; requested ${options.mode}.`);
  const skills = options.mode === 'direct' ? options.preparation?.skills.map(item => item.id) ?? [] : options.requiredSkillIds ?? [];
  if (requirement.requiredSkillIds.some(id => !skills.includes(id))) denied('Required methods are missing from the requested execution.');
  for (const id of requirement.independentOfTaskIds) {
    if (id === task.id || !await store.loadTask(id)) denied('Independent source Task must exist and differ from this Task.');
  }
  if (options.preparation) await assertTaskExecutionPreparation(task, options.mode, options.preparation, store);
}

export async function assertTaskExecutionPreparation(
  task: TaskRecord, mode: TaskExecutionRecord['mode'], input: TaskExecutionPreparation, store: TaskStore,
): Promise<void> {
  const preparation = TaskExecutionPreparationSchema.parse(input);
  const requirement = task.executionRequirements;
  if (!requirement) return;
  if (mode !== requirement.mode) denied('Prepared execution mode differs from the Task.');
  if (requirement.requiredSkillIds.some(id => !preparation.skills.some(skill => skill.id === id))) {
    denied('Required methods were not actually preloaded.');
  }
  if (mode === 'subagent' && (!preparation.capsuleHash || preparation.selectedTurnCount !== 0)) {
    denied('Delegation requires a prepared isolated Capsule without parent transcript.');
  }
  if (requirement.independentOfTaskIds.length && preparation.requestsDomainCapability) {
    denied('Independent review cannot inherit a live domain capability.');
  }
  for (const id of requirement.independentOfTaskIds) {
    const source = await store.loadTask(id);
    const execution = source?.currentExecutionId ? await store.loadExecution(source.currentExecutionId) : null;
    if (!execution?.preparation || execution.preparation.sessionId === preparation.sessionId) {
      denied('Independence requires a different actually prepared execution from the generating Task.');
    }
  }
}

export async function assertTaskExecutionCompletion(task: TaskRecord, execution: TaskExecutionRecord, store: TaskStore): Promise<void> {
  if (!task.executionRequirements) return;
  if (execution.mode !== task.executionRequirements.mode) denied('Completion mode differs from the required execution.');
  if (execution.mode === 'subagent' || task.executionRequirements.requiredSkillIds.length) {
    if (!execution.preparation) denied('Completion is missing runtime preparation proof.');
    await assertTaskExecutionPreparation(task, execution.mode, execution.preparation!, store);
  }
  if (task.executionRequirements.independentOfTaskIds.length
    && JSON.stringify(execution.independentSources) !== JSON.stringify(await readIndependentTaskSources(task, store))) {
    denied('The generating Task execution changed after review preparation; an old review cannot satisfy the new generation.');
  }
}

export async function readIndependentTaskSources(task: TaskRecord, store: TaskStore): Promise<TaskIndependentSource[]> {
  const sources: TaskIndependentSource[] = [];
  for (const taskId of task.executionRequirements?.independentOfTaskIds ?? []) {
    const source = await store.loadTask(taskId);
    const execution = source?.currentExecutionId ? await store.loadExecution(source.currentExecutionId) : null;
    if (!source || !execution?.preparation || execution.taskRevision !== source.revision) denied('Independent source execution is missing, unprepared or stale.');
    sources.push({ taskId, executionId: execution!.id, generation: execution!.generation, taskRevision: source!.revision });
  }
  return sources;
}

export function snapshotTaskRequirement(task: TaskRecord): PlanTaskRequirement {
  return {
    taskId: task.id, revision: task.revision, subject: task.subject, description: task.description,
    blockedBy: [...task.blockedBy], completionRequirements: [...task.completionRequirements],
    ...(task.executionRequirements ? { executionRequirements: structuredClone(task.executionRequirements) } : {}),
  };
}

export function hashTaskRequirement(task: TaskRecord): string {
  return createHash('sha256').update(JSON.stringify(snapshotTaskRequirement(task))).digest('hex');
}

export async function preparePlanTaskRequirements(
  registry: { getTask(id: string): Promise<TaskRecord | null>; getExecution(id: string): Promise<TaskExecutionRecord | null> },
  taskIds: readonly string[], proposed: unknown = [],
): Promise<PlanTaskRequirement[]> {
  const changes = PlanTaskRevisionSchema.array().max(128).parse(proposed);
  if (new Set(changes.map(change => change.taskId)).size !== changes.length || changes.some(change => !taskIds.includes(change.taskId))) {
    denied('Task revision proposals must uniquely target requiredTaskIds.');
  }
  const snapshots: PlanTaskRequirement[] = [];
  for (const taskId of taskIds) {
    const task = await registry.getTask(taskId);
    if (!task) denied(`Task does not exist: ${taskId}`);
    const change = changes.find(item => item.taskId === taskId);
    if (!change) { snapshots.push(snapshotTaskRequirement(task!)); continue; }
    if (change.expectedRevision !== task!.revision || task!.status === 'completed') denied('Task revision proposal is stale or targets completed work.');
    const current = task!.currentExecutionId ? await registry.getExecution(task!.currentExecutionId) : null;
    if (current && ['queued', 'running', 'waiting', 'cancelling'].includes(current.status)) denied('Cancel and join before proposing a Task revision.');
    const { taskId: _taskId, expectedRevision: _expectedRevision, ...updates } = change;
    if (!Object.values(updates).some(value => value !== undefined)) denied('Task revision proposal contains no changes.');
    snapshots.push({ ...snapshotTaskRequirement({ ...task!, ...updates, revision: task!.revision + 1 }),
      replacesRevision: task!.revision, previousRequirementHash: hashTaskRequirement(task!) });
  }
  return snapshots;
}
