import type { WorkflowStateType } from './WorkflowGraph';

export interface RunExecutionContext {
  runId: string;
  sessionId: string;
  projectId: string;
}

export interface ActiveRunSnapshot extends RunExecutionContext {
  startedAt: number;
  stage?: string;
}

interface ActiveRunController extends ActiveRunSnapshot {
  abortController: AbortController;
  promise?: Promise<WorkflowStateType | void>;
}

export class RunExecutionService {
  private activeRuns = new Map<string, ActiveRunController>();

  startRun(
    context: RunExecutionContext,
    executor: (signal: AbortSignal) => Promise<WorkflowStateType | void>,
  ): ActiveRunSnapshot {
    const existing = this.activeRuns.get(context.runId);
    if (existing) {
      return existing;
    }

    const abortController = new AbortController();
    const controller: ActiveRunController = {
      ...context,
      startedAt: Date.now(),
      abortController,
    };

    controller.promise = executor(abortController.signal).finally(() => {
      const active = this.activeRuns.get(context.runId);
      if (active?.abortController === abortController) {
        this.activeRuns.delete(context.runId);
      }
    });

    this.activeRuns.set(context.runId, controller);
    return controller;
  }

  listActiveRuns(): ActiveRunSnapshot[] {
    return Array.from(this.activeRuns.values()).map((run) => ({
      runId: run.runId,
      sessionId: run.sessionId,
      projectId: run.projectId,
      startedAt: run.startedAt,
      stage: run.stage,
    }));
  }

  getAbortSignal(runId: string): AbortSignal | null {
    return this.activeRuns.get(runId)?.abortController.signal ?? null;
  }

  updateStage(runId: string, stage: string): void {
    const active = this.activeRuns.get(runId);
    if (!active) {
      return;
    }
    active.stage = stage;
  }

  isAbortRequested(runId: string): boolean {
    return this.activeRuns.get(runId)?.abortController.signal.aborted ?? false;
  }

  stopRun(runId: string): boolean {
    const active = this.activeRuns.get(runId);
    if (!active) {
      return false;
    }
    active.abortController.abort();
    return true;
  }

  async stopAll(): Promise<void> {
    const runIds = Array.from(this.activeRuns.keys());
    runIds.forEach((runId) => this.stopRun(runId));
    await Promise.allSettled(
      runIds.map((runId) => this.activeRuns.get(runId)?.promise),
    );
  }
}

export const runExecutionService = new RunExecutionService();
