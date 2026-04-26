import { generateEventId, nowIso } from '@shared/utils/id';
import type { HarnessTask, TaskMutation } from '@shared/types/harness';
import { runScopedStore } from './RunScopedStore';

export interface TaskBoardSnapshot {
  schemaVersion: '1';
  runId: string;
  sessionId: string;
  tasks: HarnessTask[];
  mutations: TaskMutation[];
  updatedAt: string;
}

const BOARD_PATH = 'task-board.json';

export class TaskBoard {
  read(sessionId: string, runId: string): TaskBoardSnapshot {
    return runScopedStore.readJson<TaskBoardSnapshot>(
      sessionId,
      runId,
      BOARD_PATH,
      {
        schemaVersion: '1',
        runId,
        sessionId,
        tasks: [],
        mutations: [],
        updatedAt: nowIso(),
      },
    );
  }

  listTasks(sessionId: string, runId: string): HarnessTask[] {
    return this.read(sessionId, runId).tasks;
  }

  getTask(sessionId: string, runId: string, taskId: string): HarnessTask | null {
    return this.read(sessionId, runId).tasks.find((task) => task.taskId === taskId) ?? null;
  }

  upsertTask(sessionId: string, runId: string, task: HarnessTask): HarnessTask {
    this.assertRunBinding(sessionId, runId, task);

    const snapshot = this.read(sessionId, runId);
    const existingIndex = snapshot.tasks.findIndex((item) => item.taskId === task.taskId);
    const nextTask: HarnessTask = {
      ...task,
      updatedAt: nowIso(),
    };

    const tasks = [...snapshot.tasks];
    if (existingIndex >= 0) {
      tasks[existingIndex] = {
        ...tasks[existingIndex],
        ...nextTask,
        createdAt: tasks[existingIndex].createdAt,
      };
    } else {
      tasks.push(nextTask);
    }

    this.write({
      ...snapshot,
      tasks,
      updatedAt: nowIso(),
    });

    return existingIndex >= 0 ? tasks[existingIndex] : nextTask;
  }

  mutateTask(sessionId: string, runId: string, mutation: TaskMutation): HarnessTask {
    this.assertRunBinding(sessionId, runId, mutation);

    const snapshot = this.read(sessionId, runId);
    const task = snapshot.tasks.find((item) => item.taskId === mutation.taskId);
    if (!task) {
      throw new Error(`Harness task not found: ${mutation.taskId}`);
    }

    const updatedTask: HarnessTask = {
      ...task,
      ...mutation.patch,
      taskId: task.taskId,
      runId,
      sessionId,
      createdAt: task.createdAt,
      updatedAt: nowIso(),
      completedAt: mutation.patch.status === 'completed' ? nowIso() : mutation.patch.completedAt,
    };

    this.write({
      ...snapshot,
      tasks: snapshot.tasks.map((item) => item.taskId === task.taskId ? updatedTask : item),
      mutations: [
        ...snapshot.mutations,
        {
          ...mutation,
          mutationId: mutation.mutationId || generateEventId('task-mutation'),
          reason: mutation.reason,
          createdAt: mutation.createdAt || nowIso(),
        },
      ],
      updatedAt: nowIso(),
    });

    return updatedTask;
  }

  write(snapshot: TaskBoardSnapshot): void {
    runScopedStore.writeJson(snapshot.sessionId, snapshot.runId, BOARD_PATH, snapshot);
  }

  private assertRunBinding(
    sessionId: string,
    runId: string,
    value: { sessionId: string; runId: string },
  ): void {
    if (value.sessionId !== sessionId || value.runId !== runId) {
      throw new Error(`Run binding mismatch for ${value.sessionId}/${value.runId}`);
    }
  }
}

export const taskBoard = new TaskBoard();
