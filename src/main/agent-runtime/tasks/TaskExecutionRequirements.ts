import {
  TaskExecutionPreparationSchema, TaskExecutionRequirementsSchema, PlanTaskRevisionSchema,
  type PlanTaskRequirement, type TaskExecutionPreparation, type TaskIndependentSource,
} from '@shared/types/taskExecution';
import type { StartTaskExecutionOptions, TaskCompletionResult, TaskExecutionRecord, TaskRecord } from './TaskContracts';
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
  if (requirement.profileId && requirement.profileId !== (options.preparation?.profileId ?? options.requestedProfileId)) {
    const requested = options.preparation?.profileId ?? options.requestedProfileId ?? 'unspecified';
    const correction = options.mode === 'subagent'
      ? ` Set subagent.profile to ${requirement.profileId} and retry this same Task if authorized; preserve its existing limits and consumption.`
      : '';
    denied(`Task requires profile ${requirement.profileId}; requested ${requested}.${correction}`);
  }
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
  if (requirement.profileId && (preparation.profileId !== requirement.profileId || !preparation.profileSourceHash
    || !preparation.profileSource || !preparation.providerId || !preparation.modelId
    || !preparation.reasoningLevel || preparation.reasoningLevel === 'unknown')) {
    denied('Prepared execution does not prove the required profile and model configuration.');
  }
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
  const sources = await readIndependentTaskSources(task, store);
  for (const source of sources) {
    if (!preparation.inputArtifacts.some(artifact => artifact.uri === source.resultRef && artifact.hash === source.resultHash)) {
      denied('Independent review requires the authorized source result and its exact content hash.');
    }
  }
}

export async function assertTaskExecutionCompletion(task: TaskRecord, execution: TaskExecutionRecord, store: TaskStore): Promise<void> {
  for (const epoch of execution.runtimeEpochs ?? []) {
    if (!execution.preparation || !store.verifyRuntimeEpoch || !await store.verifyRuntimeEpoch(epoch, execution.preparation)) {
      denied('Runtime identity transition lacks its signed owning-turn receipt.');
    }
  }
  if (!task.executionRequirements) return;
  if (execution.mode !== task.executionRequirements.mode) denied('Completion mode differs from the required execution.');
  if (task.executionRequirements.independentOfTaskIds.length
    && JSON.stringify(execution.independentSources) !== JSON.stringify(await readIndependentTaskSources(task, store))) {
    denied('The generating Task execution changed after review preparation; an old review cannot satisfy the new generation.');
  }
  if (execution.mode === 'subagent' || task.executionRequirements.requiredSkillIds.length || task.executionRequirements.profileId) {
    if (!execution.preparation) denied('Completion is missing runtime preparation proof.');
    await assertTaskExecutionPreparation(task, execution.mode, execution.preparation!, store);
  }
}

export async function readIndependentTaskSources(task: TaskRecord, store: TaskStore): Promise<TaskIndependentSource[]> {
  const sources: TaskIndependentSource[] = [];
  for (const taskId of task.executionRequirements?.independentOfTaskIds ?? []) {
    const source = await store.loadTask(taskId);
    const execution = source?.currentExecutionId ? await store.loadExecution(source.currentExecutionId) : null;
    if (!source || !execution?.preparation || execution.taskRevision !== source.revision) denied('Independent source execution is missing, unprepared or stale.');
    if (!['completed', 'partial'].includes(execution!.status) || !execution!.settledAt || !execution!.result?.resultRef || !execution!.result.resultHash) {
      denied('Independent source must be settled with a versioned result reference and hash.');
    }
    const resultRef = execution!.result!.resultRef!;
    const resultHash = execution!.result!.resultHash!;
    if (!store.verifyReviewArtifact || !await store.verifyReviewArtifact(resultRef, resultHash)) {
      denied('Independent source result is unavailable, changed or no longer current.');
    }
    sources.push({ taskId, executionId: execution!.id, generation: execution!.generation, taskRevision: source!.revision, resultRef, resultHash });
  }
  return sources;
}

/** A review source must be usable before its execution becomes immutable. */
export async function assertIndependentReviewResult(task: TaskRecord, result: TaskCompletionResult, store: TaskStore): Promise<void> {
  const dependedOn = (await store.listTasks()).some(candidate => candidate.executionRequirements?.independentOfTaskIds.includes(task.id));
  if (!dependedOn) return;
  if (!result.resultRef || !result.resultHash) denied('A Task used by independent review requires resultRef and resultHash in its execution result.');
  if (!store.verifyReviewArtifact || !await store.verifyReviewArtifact(result.resultRef!, result.resultHash!)) {
    denied('The independent review result reference is unavailable, changed or cannot be verified.');
  }
}

/** A completed Task can run again to repair an invalidated review dependency. */
export async function canReexecuteInvalidatedTask(task: TaskRecord, store: TaskStore): Promise<boolean> {
  if (task.status !== 'completed' || !task.currentExecutionId) return false;
  const execution = await store.loadExecution(task.currentExecutionId);
  if (!execution || execution.status !== 'completed') return false;
  if (task.executionRequirements?.independentOfTaskIds.length) {
    try {
      const current = await readIndependentTaskSources(task, store);
      return JSON.stringify(current) !== JSON.stringify(execution.independentSources);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('TASK_EXECUTION_REQUIREMENTS:')) return false;
      throw error;
    }
  }
  const ref = execution.result?.resultRef;
  const hash = execution.result?.resultHash;
  const dependedOn = (await store.listTasks()).some(candidate => candidate.executionRequirements?.independentOfTaskIds.includes(task.id));
  if (!dependedOn) return false;
  if (!ref || !hash) return true;
  return Boolean(store.verifyReviewArtifact && !await store.verifyReviewArtifact(ref, hash));
}

/** Continue an incomplete review when the caller supplies a previously ungranted source. */
export async function canContinueReviewWithNewSources(
  task: TaskRecord, options: StartTaskExecutionOptions, store: TaskStore,
): Promise<boolean> {
  if (task.status !== 'completed' || options.mode !== 'subagent' || !task.currentExecutionId
    || !task.executionRequirements?.independentOfTaskIds.length) return false;
  const execution = await store.loadExecution(task.currentExecutionId);
  if (execution?.status !== 'completed' || !execution.result?.unresolved?.some(item => typeof item !== 'string' || item.trim())
    || !execution.preparation) return false;
  const previous = new Set(execution.preparation.inputArtifacts.map(item => item.uri));
  return options.requestedInputArtifactRefs?.some(uri => !previous.has(uri)) ?? false;
}

/** A reviewed snapshot can remain readable while its owner prepares a corrected version. */
export async function canContinueReviewedSource(task: TaskRecord, store: TaskStore): Promise<boolean> {
  if (task.status !== 'completed' || !task.currentExecutionId) return false;
  if ((await store.loadExecution(task.currentExecutionId))?.status !== 'completed') return false;
  for (const review of await store.listTasks()) {
    if (!['completed', 'blocked'].includes(review.status) || !review.currentExecutionId
      || !review.executionRequirements?.independentOfTaskIds.includes(task.id)) continue;
    const execution = await store.loadExecution(review.currentExecutionId);
    if (execution && ['completed', 'partial'].includes(execution.status) && execution.independentSources?.some(source =>
      source.taskId === task.id && source.executionId === task.currentExecutionId)) return true;
  }
  return false;
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
  for (const task of snapshots) {
    for (const sourceId of task.executionRequirements?.independentOfTaskIds ?? []) {
      if (sourceId === task.taskId || !await registry.getTask(sourceId)) {
        denied('Independent source Task must exist and differ from the review Task before plan review.');
      }
    }
  }
  return snapshots;
}
