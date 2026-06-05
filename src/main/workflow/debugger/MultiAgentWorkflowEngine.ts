import type { AgentRole } from '@shared/types/agent';
import type {
  AgentRuntimeTaskDescriptor,
  AgentRuntimeTaskGraphDescriptor,
} from '@shared/types/agentRuntime';
import type { HarnessTask, HarnessTaskStatus } from '@shared/types/harness';

const mapTaskStatus = (
  status: HarnessTaskStatus,
): AgentRuntimeTaskDescriptor['status'] => {
  if (status === 'in_progress') return 'running';
  if (status === 'rejected') return 'failed';
  return status;
};

export class MultiAgentWorkflowEngine {
  constructor(
    private readonly listTasksForRun: (sessionId: string, runId: string) => HarnessTask[] = (sessionId, runId) => {
      const { taskBoard } = require('./TaskBoard') as typeof import('./TaskBoard');
      return taskBoard.listTasks(sessionId, runId);
    },
  ) {}

  createDebuggerGraph(input: {
    runId: string;
    sessionId: string;
    tasks: HarnessTask[];
  }): AgentRuntimeTaskGraphDescriptor {
    return {
      id: `debugger-serial-${input.runId}`,
      runId: input.runId,
      mode: 'debugger',
      execution: 'serial',
      status: this.resolveGraphStatus(input.tasks),
      tasks: input.tasks.map((task) => ({
        id: task.taskId,
        title: task.title,
        status: mapTaskStatus(task.status),
        ownerAgentId: task.owner === 'harness' ? 'rdc-debugger' : task.owner as AgentRole,
        stage: task.stage,
        dependsOn: task.dependsOn,
      })),
    };
  }

  readDebuggerGraph(sessionId: string, runId: string): AgentRuntimeTaskGraphDescriptor {
    return this.createDebuggerGraph({
      runId,
      sessionId,
      tasks: this.listTasksForRun(sessionId, runId),
    });
  }

  assertSerialExecution(graph: AgentRuntimeTaskGraphDescriptor): void {
    if (graph.execution !== 'serial') {
      throw new Error(`Debugger workflow must be serial: ${graph.id}`);
    }
    const runningTasks = graph.tasks.filter((task) => task.status === 'running');
    if (runningTasks.length > 1) {
      throw new Error(`Debugger workflow has concurrent running tasks: ${runningTasks.map((task) => task.id).join(', ')}`);
    }
  }

  private resolveGraphStatus(tasks: HarnessTask[]): AgentRuntimeTaskGraphDescriptor['status'] {
    if (tasks.some((task) => task.status === 'in_progress')) return 'running';
    if (tasks.some((task) => task.status === 'rejected')) return 'failed';
    if (tasks.some((task) => task.status === 'cancelled')) return 'cancelled';
    if (tasks.length > 0 && tasks.every((task) => task.status === 'completed')) return 'completed';
    return 'pending';
  }
}

export const multiAgentWorkflowEngine = new MultiAgentWorkflowEngine();
