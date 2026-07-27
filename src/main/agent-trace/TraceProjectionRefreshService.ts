import type { AgentRunPresentation } from '@shared/types/agenticTrace';
import type { SessionScope } from '@shared/types/session';
import type { TraceSessionResult } from '@shared/types/trace';
import { traceService } from './TraceService';
import { workflowProjectionPublisher } from '../workflow/debugger/WorkflowProjectionPublisher';

export interface TraceProjectionRefreshDeps {
  getProjection(sessionId: string): Promise<TraceSessionResult>;
  publish(scope: SessionScope, presentation: AgentRunPresentation): void;
}

const defaultDeps: TraceProjectionRefreshDeps = {
  getProjection: (sessionId) => traceService.getSession(sessionId),
  publish: (scope, presentation) => workflowProjectionPublisher.publishTraceProjectionChanged(scope, presentation),
};

/** Coalesces task-driven trace refreshes without creating a second task projection path. */
export class TraceProjectionRefreshService {
  private readonly pending = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(private readonly deps: TraceProjectionRefreshDeps = defaultDeps) {}

  schedule(sessionId: string): void {
    if (!sessionId || sessionId.includes('::subagent::') || this.pending.has(sessionId)) {
      return;
    }
    const timer = setTimeout(() => {
      this.pending.delete(sessionId);
      void this.flush(sessionId);
    }, 40);
    this.pending.set(sessionId, timer);
  }

  clear(sessionId: string): void {
    const timer = this.pending.get(sessionId);
    if (!timer) return;
    clearTimeout(timer);
    this.pending.delete(sessionId);
  }

  private async flush(sessionId: string): Promise<void> {
    try {
      const result = await this.deps.getProjection(sessionId);
      if (result.success && result.presentation) {
        this.deps.publish({ projectId: result.presentation.projectId, sessionId }, result.presentation);
      }
    } catch (error) {
      console.error('[TraceProjectionRefresh] Failed to refresh task projection:', error);
    }
  }
}

export const traceProjectionRefreshService = new TraceProjectionRefreshService();