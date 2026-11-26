/**
 * BackgroundTaskTools — the background_* tools over durable background executions: query, wait,
 * result, message, cancel and join, limited to executions the calling session (or its delegated
 * Task subtree) owns.
 */

import { AppError } from '@shared/errors/appError';
import { getDelegatedTaskScope, type TaskExecutionRecord, type TaskRecord } from '../tasks';
import { projectSubagentExecution } from './SubagentResultEnvelope';
import type { BackgroundSubagentService } from './BackgroundSubagentService';
import type { AgentTool } from '../agent/AgentTool';

/** What the background tools read and drive on the owning service, for one owner session. */
export interface BackgroundTaskToolHost {
  requireOwned: (ownerSessionId: string, executionId: string) => Promise<TaskExecutionRecord>;
  listTasks: (ownerSessionId: string) => Promise<TaskRecord[]>;
  query: BackgroundSubagentService['query'];
  join: BackgroundSubagentService['join'];
  messages: BackgroundSubagentService['messages'];
  postMessage: BackgroundSubagentService['postMessage'];
  cancel: BackgroundSubagentService['cancel'];
}

export function createBackgroundTaskTools(host: BackgroundTaskToolHost, sessionId?: string | null): AgentTool[] {
  const delegatedScope = sessionId ? getDelegatedTaskScope(sessionId) : null;
  const requireSession = () => {
    if (!sessionId) throw new AppError('BACKGROUND_SESSION_REQUIRED', 'durable execution requires a parent session.');
    return delegatedScope?.ownerSessionId ?? sessionId;
  };
  const requireOwned = async (args: Record<string, unknown>) => {
    const id = executeId(args);
    const execution = await host.requireOwned(requireSession(), id);
    if (delegatedScope) {
      const tasks = await host.listTasks(requireSession());
      let taskId: string | undefined = execution.taskId;
      let inScope = false;
      while (taskId) {
        if (taskId === delegatedScope.rootTaskId) {
          inScope = true;
          break;
        }
        taskId = tasks.find((task) => task.id === taskId)?.parentTaskId;
      }
      if (!inScope)
        throw new AppError('BACKGROUND_EXECUTION_NOT_FOUND', 'execution is outside this delegated Task subtree.');
    }
    return id;
  };
  const executeId = (args: Record<string, unknown>) => String(args.executionId ?? '').trim();
  const common = {
    permissionHint: 'readonly' as const,
    spec: {
      isReadOnly: true,
      concurrency: 'shared' as const,
      isDestructive: false,
      sideEffect: 'session' as const,
      category: 'task' as const,
      requiresApproval: false,
    },
  };
  const orchestration = { ...common, spec: { ...common.spec, concurrency: 'orchestration-parallel' as const } };
  return [
    {
      name: 'background_query',
      label: 'Query Background Task',
      description:
        'Read durable execution status once. Do not repeatedly poll; use background_wait when awaiting a live execution.',
      parameters: { type: 'object', required: ['executionId'], properties: { executionId: { type: 'string' } } },
      ...common,
      execute: async (_id, args) => {
        const execution = await host.query(requireSession(), await requireOwned(args));
        const projection = projectSubagentExecution(execution);
        return { content: [{ type: 'text', text: JSON.stringify(projection) }], details: projection };
      },
    },
    {
      name: 'background_wait',
      label: 'Wait Background Task',
      description: 'Event-driven join of a live background execution, then returns its durable result.',
      parameters: { type: 'object', required: ['executionId'], properties: { executionId: { type: 'string' } } },
      ...orchestration,
      execute: async (_id, args, signal) => {
        const id = await requireOwned(args);
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        let listener: (() => void) | undefined;
        try {
          await Promise.race([
            host.join(id),
            new Promise<void>((_, reject) => {
              listener = () => reject(new DOMException('Aborted', 'AbortError'));
              signal?.addEventListener('abort', listener, { once: true });
            }),
          ]);
        } finally {
          if (listener) signal?.removeEventListener('abort', listener);
        }
        const projection = projectSubagentExecution(await host.query(requireSession(), id));
        return { content: [{ type: 'text', text: JSON.stringify(projection) }], details: projection };
      },
    },
    {
      name: 'background_result',
      label: 'Background Result',
      description:
        'Read the bounded structured result and durable message cursor. Pass the executionId returned by subagent (execution_...), not the resultRef artifact filename (subagent-execution_...json).',
      parameters: {
        type: 'object',
        required: ['executionId'],
        properties: { executionId: { type: 'string' }, cursor: { type: 'number' } },
      },
      ...common,
      execute: async (_id, args) => {
        const id = await requireOwned(args);
        const [execution, mailbox] = await Promise.all([
          host.query(requireSession(), id),
          host.messages(requireSession(), id, Number(args.cursor ?? 0)),
        ]);
        const result = projectSubagentExecution(execution)?.result;
        return {
          content: [{ type: 'text', text: JSON.stringify({ result, ...mailbox }) }],
          details: { executionId: execution?.id, result, mailbox },
        };
      },
    },
    {
      name: 'background_message',
      label: 'Message Background Task',
      description:
        'Append bounded untrusted owner data to the durable execution mailbox. It never mutates an in-flight frozen prompt.',
      parameters: {
        type: 'object',
        required: ['executionId', 'generation', 'body'],
        properties: {
          executionId: { type: 'string' },
          generation: { type: 'number' },
          body: { type: 'string', maxLength: 8000 },
        },
      },
      ...common,
      execute: async (_id, args) => {
        const id = await requireOwned(args);
        const message = await host.postMessage(requireSession(), id, Number(args.generation), String(args.body ?? ''));
        return {
          content: [{ type: 'text', text: `Message queued at sequence ${message.sequence}.` }],
          details: { message },
        };
      },
    },
    {
      name: 'background_cancel',
      label: 'Cancel Background Task',
      description: 'Abort and join the live execution before returning.',
      parameters: { type: 'object', required: ['executionId'], properties: { executionId: { type: 'string' } } },
      ...orchestration,
      execute: async (_id, args) => {
        const id = await requireOwned(args);
        await host.cancel(requireSession(), id);
        return {
          content: [{ type: 'text', text: `Background execution stopped and joined: ${id}` }],
          details: { executionId: id },
        };
      },
    },
    {
      name: 'background_join',
      label: 'Join Background Task',
      description: 'Join a live execution without cancelling it, then return its durable state.',
      parameters: { type: 'object', required: ['executionId'], properties: { executionId: { type: 'string' } } },
      ...orchestration,
      execute: async (_id, args) => {
        const id = await requireOwned(args);
        await host.join(id);
        const projection = projectSubagentExecution(await host.query(requireSession(), id));
        return { content: [{ type: 'text', text: JSON.stringify(projection) }], details: projection };
      },
    },
  ];
}
