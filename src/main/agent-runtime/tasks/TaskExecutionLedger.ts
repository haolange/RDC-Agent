import {
  type TaskExecutionMessage,
  type TaskExecutionRecord,
  type TaskMessageKind,
  type TaskRootBudgetRecord,
} from './TaskContracts';
import { TaskRegistryCore } from './TaskRegistryCore';
import { isTerminalExecutionStatus, validateBudget, validateRootBudget } from './taskRegistryRules';

/**
 * TaskExecutionLedger — per-execution accounting of a running Task execution: monotonic budget
 * counters and narrowing ceilings, the parent/child mailbox with its acknowledgement cursors,
 * the frozen plan reference, and the shared root budget.
 */
export class TaskExecutionLedger extends TaskRegistryCore {
  async updateExecutionBudget(
    id: string,
    input: {
      expectedGeneration: number;
      toolCalls?: number;
      subagents?: number;
      childDepth?: number;
      maxToolCalls?: number;
      maxSubagents?: number;
      maxChildDepth?: number;
      deadlineAt?: number;
    },
  ): Promise<TaskExecutionRecord> {
    return this.store.withLock('state', async () => {
      const execution = await this.requireExecution(id);
      const task = await this.requireTask(execution.taskId);
      this.assertCurrent(task, execution, input.expectedGeneration);
      if (isTerminalExecutionStatus(execution.status)) throw new Error('Settled execution budget cannot be changed.');
      const next = { ...execution.budget };
      for (const key of ['toolCalls', 'subagents', 'childDepth'] as const) {
        const value = input[key];
        if (value === undefined) continue;
        const previous = next[key];
        if (!Number.isFinite(value) || value < previous)
          throw new Error(`Execution budget counter must be finite and monotonic: ${key}.`);
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
  async appendExecutionMessage(
    id: string,
    input: {
      expectedGeneration: number;
      kind: TaskMessageKind;
      direction: TaskExecutionMessage['direction'];
      body: string;
    },
  ): Promise<TaskExecutionMessage> {
    await this.requireExecution(id);
    return this.store.withLock('state', async () => {
      const execution = await this.requireExecution(id);
      const task = await this.requireTask(execution.taskId);
      this.assertCurrent(task, execution, input.expectedGeneration);
      if (!input.body.trim()) throw new Error('Message body is required.');
      const existing = await this.store.listMessages(id);
      const sequence = (existing.at(-1)?.sequence ?? 0) + 1;
      const message = {
        id: `${id}:${sequence}`,
        taskId: task.id,
        executionId: id,
        generation: execution.generation,
        sequence,
        kind: input.kind,
        direction: input.direction,
        body: input.body,
        createdAt: Date.now(),
      } satisfies TaskExecutionMessage;
      await this.store.appendMessage(message);
      return message;
    });
  }
  async consumeExecutionMessages(
    id: string,
    afterSequence = 0,
    direction?: TaskExecutionMessage['direction'],
  ): Promise<{ messages: TaskExecutionMessage[]; cursor: number }> {
    const messages = (await this.store.listMessages(id, afterSequence)).filter(
      (message) => !direction || message.direction === direction,
    );
    return { messages, cursor: messages.at(-1)?.sequence ?? afterSequence };
  }
  async ackExecutionMessages(
    id: string,
    input: { expectedGeneration: number; throughSequence: number; direction: 'to_child' | 'to_parent' },
  ): Promise<TaskExecutionRecord> {
    return this.store.withLock('state', async () => {
      const execution = await this.requireExecution(id);
      const task = await this.requireTask(execution.taskId);
      this.assertCurrent(task, execution, input.expectedGeneration);
      const cursorKey = input.direction === 'to_child' ? 'childMessageAckSequence' : 'parentMessageAckSequence';
      const cursor = execution[cursorKey];
      if (!Number.isInteger(input.throughSequence) || input.throughSequence < cursor)
        throw new Error('Message acknowledgement cursor must be monotonic.');
      if (input.throughSequence === cursor) return execution;
      const messages = await this.store.listMessages(id, cursor);
      if (
        !messages.some((message) => message.direction === input.direction && message.sequence === input.throughSequence)
      )
        throw new Error('Message acknowledgement must reference a delivered message in the requested direction.');
      execution[cursorKey] = input.throughSequence;
      execution.updatedAt = Date.now();
      await this.store.saveExecution(execution);
      return execution;
    });
  }
  async bindExecutionPlanRef(
    id: string,
    input: { expectedGeneration: number; frozenPlanRef: string },
  ): Promise<TaskExecutionRecord> {
    return this.store.withLock('state', async () => {
      const execution = await this.requireExecution(id);
      const task = await this.requireTask(execution.taskId);
      this.assertCurrent(task, execution, input.expectedGeneration);
      if (!input.frozenPlanRef.trim()) throw new Error('Frozen plan reference is required.');
      if (execution.frozenPlanRef && execution.frozenPlanRef !== input.frozenPlanRef)
        throw new Error('Execution frozen plan reference is already bound.');
      if (execution.frozenPlanRef === input.frozenPlanRef) return execution;
      execution.frozenPlanRef = input.frozenPlanRef;
      execution.updatedAt = Date.now();
      await this.store.saveExecution(execution);
      return execution;
    });
  }
  async updateRootBudget(
    id: string,
    snapshot: Omit<TaskRootBudgetRecord, 'id' | 'updatedAt'>,
  ): Promise<TaskRootBudgetRecord> {
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
}
