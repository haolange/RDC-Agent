import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import { orderTasks } from './taskProjection';
import {
  TASK_SCHEMA_VERSION,
  type TaskExecutionMessage,
  type TaskExecutionRecord,
  type TaskRecord,
  type TaskRootBudgetRecord,
} from './TaskContracts';

interface TaskStateDocument {
  schemaVersion: typeof TASK_SCHEMA_VERSION;
  tasks: Record<string, TaskRecord>;
  executions: Record<string, TaskExecutionRecord>;
  messages: Record<string, TaskExecutionMessage[]>;
  rootBudgets: Record<string, TaskRootBudgetRecord>;
}

export interface TaskStoreCommit {
  tasks?: TaskRecord[];
  executions?: TaskExecutionRecord[];
  messages?: TaskExecutionMessage[];
  rootBudgets?: TaskRootBudgetRecord[];
  deletedTaskIds?: string[];
}

export interface TaskStore {
  loadTask(id: string): Promise<TaskRecord | null>;
  saveTask(task: TaskRecord): Promise<void>;
  listTasks(): Promise<TaskRecord[]>;
  deleteTask(id: string): Promise<void>;
  loadExecution(id: string): Promise<TaskExecutionRecord | null>;
  saveExecution(execution: TaskExecutionRecord): Promise<void>;
  listExecutions(taskId?: string): Promise<TaskExecutionRecord[]>;
  appendMessage(message: TaskExecutionMessage): Promise<void>;
  listMessages(executionId: string, afterSequence?: number): Promise<TaskExecutionMessage[]>;
  loadRootBudget(id: string): Promise<TaskRootBudgetRecord | null>;
  saveRootBudget(budget: TaskRootBudgetRecord): Promise<void>;
  commit(changes: TaskStoreCommit): Promise<void>;
  withLock<T>(key: string, operation: () => Promise<T>): Promise<T>;
}

const processLocks = new Map<string, Promise<void>>();
const initializations = new Map<string, Promise<void>>();

export class FileTaskStore implements TaskStore {
  private readonly root: string;
  private readonly statePath: string;

  constructor(tasksDir: string) {
    this.root = path.resolve(tasksDir);
    this.statePath = path.join(this.root, 'task-state.json');
  }

  async withLock<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const name = `${this.root}:${key}`;
    const previous = processLocks.get(name) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const tail = previous.then(() => gate);
    processLocks.set(name, tail);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (processLocks.get(name) === tail) processLocks.delete(name);
    }
  }

  async loadTask(id: string): Promise<TaskRecord | null> {
    return clone((await this.readState()).tasks[id] ?? null);
  }

  async saveTask(task: TaskRecord): Promise<void> {
    await this.commit({ tasks: [task] });
  }

  async listTasks(): Promise<TaskRecord[]> {
    return orderTasks(Object.values((await this.readState()).tasks).map(clone));
  }

  async deleteTask(id: string): Promise<void> {
    await this.commit({ deletedTaskIds: [id] });
  }

  async loadExecution(id: string): Promise<TaskExecutionRecord | null> {
    return clone((await this.readState()).executions[id] ?? null);
  }

  async saveExecution(execution: TaskExecutionRecord): Promise<void> {
    await this.commit({ executions: [execution] });
  }

  async listExecutions(taskId?: string): Promise<TaskExecutionRecord[]> {
    return Object.values((await this.readState()).executions)
      .filter((execution) => !taskId || execution.taskId === taskId)
      .map(clone)
      .sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id));
  }

  async appendMessage(message: TaskExecutionMessage): Promise<void> {
    await this.commit({ messages: [message] });
  }

  async listMessages(executionId: string, afterSequence = 0): Promise<TaskExecutionMessage[]> {
    return ((await this.readState()).messages[executionId] ?? [])
      .filter((message) => message.sequence > afterSequence)
      .map(clone)
      .sort((left, right) => left.sequence - right.sequence);
  }
  async loadRootBudget(id: string): Promise<TaskRootBudgetRecord | null> { return clone((await this.readState()).rootBudgets[id] ?? null); }
  async saveRootBudget(budget: TaskRootBudgetRecord): Promise<void> { await this.commit({ rootBudgets: [budget] }); }

  async commit(changes: TaskStoreCommit): Promise<void> {
    await this.ensureInitialized();
    const state = await this.readStateFile();
    for (const task of changes.tasks ?? []) state.tasks[task.id] = clone(task);
    for (const execution of changes.executions ?? []) state.executions[execution.id] = clone(execution);
    for (const message of changes.messages ?? []) {
      const entries = state.messages[message.executionId] ?? [];
      if (entries.some((entry) => entry.id === message.id)) throw new Error(`Duplicate task message: ${message.id}`);
      state.messages[message.executionId] = [...entries, clone(message)];
    }
    for (const budget of changes.rootBudgets ?? []) state.rootBudgets[budget.id] = clone(budget);
    for (const id of changes.deletedTaskIds ?? []) delete state.tasks[id];
    await this.writeState(state);
  }

  private async readState(): Promise<TaskStateDocument> {
    await this.ensureInitialized();
    return this.readStateFile();
  }

  private async ensureInitialized(): Promise<void> {
    let pending = initializations.get(this.root);
    if (!pending) {
      pending = this.initialize();
      initializations.set(this.root, pending);
    }
    try { await pending; } catch (error) {
      if (initializations.get(this.root) === pending) initializations.delete(this.root);
      throw error;
    }
  }

  private async initialize(): Promise<void> {
    await fs.mkdir(this.root, { recursive: true });
    try {
      await this.readStateFile();
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    if ((await fs.readdir(this.root)).length) {
      throw new Error('TASK_STORAGE_REQUIRES_CONVERSION: nonempty task storage has no current task-state.json; original files were preserved.');
    }
    await this.writeState(emptyState());
  }

  private async readStateFile(): Promise<TaskStateDocument> {
    const parsed = JSON.parse(await fs.readFile(this.statePath, 'utf8')) as Partial<TaskStateDocument>;
    if (parsed.schemaVersion !== TASK_SCHEMA_VERSION) {
      throw new Error(`Unsupported task state schema version: ${String(parsed.schemaVersion)}.`);
    }
    if (!isRecord(parsed.tasks) || !isRecord(parsed.executions) || !isRecord(parsed.messages) || !isRecord(parsed.rootBudgets)) {
      throw new Error('Task state document is malformed.');
    }
    const state = parsed as TaskStateDocument;
    validateState(state);
    return state;
  }

  private async writeState(state: TaskStateDocument): Promise<void> {
    validateState(state);
    await writeAtomic(this.statePath, Buffer.from(`${JSON.stringify(state, null, 2)}\n`, 'utf8'));
  }
}

export class MemoryTaskStore implements TaskStore {
  private state = emptyState();
  private locks = new Map<string, Promise<void>>();

  async withLock<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const tail = previous.then(() => gate);
    this.locks.set(key, tail);
    await previous;
    try { return await operation(); } finally {
      release();
      if (this.locks.get(key) === tail) this.locks.delete(key);
    }
  }

  async loadTask(id: string): Promise<TaskRecord | null> { return clone(this.state.tasks[id] ?? null); }
  async saveTask(task: TaskRecord): Promise<void> { await this.commit({ tasks: [task] }); }
  async listTasks(): Promise<TaskRecord[]> { return orderTasks(Object.values(this.state.tasks).map(clone)); }
  async deleteTask(id: string): Promise<void> { await this.commit({ deletedTaskIds: [id] }); }
  async loadExecution(id: string): Promise<TaskExecutionRecord | null> { return clone(this.state.executions[id] ?? null); }
  async saveExecution(execution: TaskExecutionRecord): Promise<void> { await this.commit({ executions: [execution] }); }
  async listExecutions(taskId?: string): Promise<TaskExecutionRecord[]> { return Object.values(this.state.executions).filter((entry) => !taskId || entry.taskId === taskId).map(clone); }
  async appendMessage(message: TaskExecutionMessage): Promise<void> { await this.commit({ messages: [message] }); }
  async listMessages(id: string, after = 0): Promise<TaskExecutionMessage[]> { return (this.state.messages[id] ?? []).filter((entry) => entry.sequence > after).map(clone); }
  async loadRootBudget(id: string): Promise<TaskRootBudgetRecord | null> { return clone(this.state.rootBudgets[id] ?? null); }
  async saveRootBudget(budget: TaskRootBudgetRecord): Promise<void> { await this.commit({ rootBudgets: [budget] }); }
  async commit(changes: TaskStoreCommit): Promise<void> {
    const next = clone(this.state);
    for (const task of changes.tasks ?? []) next.tasks[task.id] = clone(task);
    for (const execution of changes.executions ?? []) next.executions[execution.id] = clone(execution);
    for (const message of changes.messages ?? []) next.messages[message.executionId] = [...(next.messages[message.executionId] ?? []), clone(message)];
    for (const budget of changes.rootBudgets ?? []) next.rootBudgets[budget.id] = clone(budget);
    for (const id of changes.deletedTaskIds ?? []) delete next.tasks[id];
    this.state = next;
  }
}

function emptyState(): TaskStateDocument {
  return { schemaVersion: TASK_SCHEMA_VERSION, tasks: {}, executions: {}, messages: {}, rootBudgets: {} };
}

async function writeAtomic(target: string, bytes: Buffer): Promise<void> {
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  await fs.writeFile(temporary, bytes, { flag: 'wx' });
  try {
    // Keep the same candidate and store lock while a transient Windows reader
    // releases the destination. Never remove the authoritative file first.
    for (let attempt = 0; ; attempt++) {
      try { await fs.rename(temporary, target); break; }
      catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (attempt >= 3 || (code !== 'EPERM' && code !== 'EBUSY')) throw error;
        await new Promise(resolve => setTimeout(resolve, 10 * 2 ** attempt));
      }
    }
  } catch (error) {
    await fs.unlink(temporary).catch(() => undefined);
    throw error;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function validateState(state: TaskStateDocument): void {
  for (const [id, budget] of Object.entries(state.rootBudgets)) {
    if (budget.id !== id || [budget.toolCalls, budget.subagents, budget.maxToolCalls, budget.maxSubagents,
      budget.maxChildDepth, budget.deadlineAt, budget.startedAt, budget.updatedAt].some((value) => !Number.isFinite(value) || value < 0)
      || budget.toolCalls > budget.maxToolCalls || budget.subagents > budget.maxSubagents) {
      throw new Error(`Malformed root Task budget: ${id}.`);
    }
  }
  for (const [id, task] of Object.entries(state.tasks)) {
    if (task.schemaVersion !== TASK_SCHEMA_VERSION || task.id !== id || typeof task.subject !== 'string'
      || !Array.isArray(task.blockedBy) || !Array.isArray(task.blocks) || !Array.isArray(task.executionIds)
      || !Array.isArray(task.completionRequirements) || typeof task.revision !== 'number'
      || typeof task.description !== 'string' || typeof task.createdAt !== 'number' || typeof task.updatedAt !== 'number'
      || !['pending', 'in_progress', 'blocked', 'completed', 'cancelled'].includes(task.status)) {
      throw new Error(`Malformed canonical task record: ${id}.`);
    }
    if (task.parentTaskId && !state.tasks[task.parentTaskId]) throw new Error(`Task ${id} references missing parent ${task.parentTaskId}.`);
    for (const dependency of task.blockedBy) {
      if (!state.tasks[dependency]) throw new Error(`Task ${id} references missing dependency ${dependency}.`);
      if (!state.tasks[dependency]!.blocks.includes(id)) throw new Error(`Task dependency links are not reciprocal: ${dependency} -> ${id}.`);
    }
    for (const blocked of task.blocks) {
      if (!state.tasks[blocked]?.blockedBy.includes(id)) throw new Error(`Task dependency links are not reciprocal: ${id} -> ${blocked}.`);
    }
    for (const executionId of task.executionIds) if (!state.executions[executionId]) throw new Error(`Task ${id} references missing execution ${executionId}.`);
    if (task.currentExecutionId && state.executions[task.currentExecutionId]?.taskId !== id) throw new Error(`Task ${id} references an invalid current execution.`);
  }
  for (const [id, execution] of Object.entries(state.executions)) {
    const owner = state.tasks[execution.taskId];
    if (execution.schemaVersion !== TASK_SCHEMA_VERSION || execution.id !== id || !owner
      || !owner.executionIds.includes(id) || !Number.isInteger(execution.generation) || execution.generation < 1
      || !Number.isInteger(execution.taskRevision) || execution.taskRevision < 1 || !isRecord(execution.budget)
      || typeof execution.runtimeInstanceId !== 'string' || !execution.runtimeInstanceId.trim()
      || !Number.isInteger(execution.childMessageAckSequence) || execution.childMessageAckSequence < 0
      || !Number.isInteger(execution.parentMessageAckSequence) || execution.parentMessageAckSequence < 0
      || !['direct', 'subagent', 'handoff'].includes(execution.mode)
      || !['queued', 'running', 'waiting', 'cancelling', 'completed', 'partial', 'blocked', 'failed', 'cancelled', 'interrupted'].includes(execution.status)
      || !validBudget(execution.budget)) {
      throw new Error(`Malformed canonical task execution: ${id}.`);
    }
    if (execution.rootBudgetId && !state.rootBudgets[execution.rootBudgetId]) {
      throw new Error(`Execution references missing root budget: ${id}.`);
    }
    const expectedDisposition = execution.status === 'completed' ? 'completed'
      : execution.status === 'partial' ? 'partial'
        : execution.status === 'cancelled' ? 'cancelled'
          : ['blocked', 'failed', 'interrupted'].includes(execution.status) ? 'blocked' : undefined;
    if ((expectedDisposition && execution.result?.disposition !== expectedDisposition)
      || (!expectedDisposition && execution.result !== undefined)) throw new Error(`Execution status/result contradiction: ${id}.`);
    if (execution.result && Boolean(execution.result.resultRef) !== Boolean(execution.result.resultHash)) {
      throw new Error(`Execution result reference/hash contradiction: ${id}.`);
    }
  }
  for (const [executionId, messages] of Object.entries(state.messages)) {
    const execution = state.executions[executionId];
    if (!execution || !Array.isArray(messages)) throw new Error(`Messages reference missing execution: ${executionId}.`);
    const sequences = new Set<number>();
    for (const message of messages) {
      if (message.schemaVersion !== TASK_SCHEMA_VERSION || message.executionId !== executionId
        || message.taskId !== execution.taskId || message.generation !== execution.generation
        || message.id !== `${executionId}:${message.sequence}` || !Number.isInteger(message.sequence) || message.sequence < 1
        || !['progress', 'blocked', 'decision_required', 'result'].includes(message.kind)
        || !['to_parent', 'to_child'].includes(message.direction)
        || typeof message.body !== 'string' || !message.body.trim() || sequences.has(message.sequence)) throw new Error(`Malformed task execution message: ${message.id}.`);
      sequences.add(message.sequence);
    }
  }
}

function validBudget(value: TaskExecutionRecord['budget']): boolean {
  const counters = [value.toolCalls, value.subagents, value.childDepth, value.startedAt];
  const limits = [value.maxToolCalls, value.maxSubagents, value.maxChildDepth, value.deadlineAt]
    .filter((entry): entry is number => entry !== undefined);
  if ([...counters, ...limits].some((entry) => !Number.isFinite(entry) || entry < 0)) return false;
  return (value.maxToolCalls === undefined || value.toolCalls <= value.maxToolCalls)
    && (value.maxSubagents === undefined || value.subagents <= value.maxSubagents)
    && (value.maxChildDepth === undefined || value.childDepth <= value.maxChildDepth);
}

function clone<T>(value: T): T {
  return value === null ? value : JSON.parse(JSON.stringify(value)) as T;
}
