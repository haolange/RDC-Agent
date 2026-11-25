import { isSubagentScopeId } from '@shared/utils/executionScope';
import { workflowProjectionPublisher } from './WorkflowProjectionPublisher';
import type { AgentRunPresentation } from '@shared/types/agenticTrace';
import type { SessionScope } from '@shared/types/session';
import type { TraceSessionResult } from '@shared/types/trace';

export interface TraceProjectionRefreshDeps {
  getProjection(sessionId: string): Promise<TraceSessionResult>;
  publish(scope: SessionScope, presentation: AgentRunPresentation): void;
}

/** Builds a session's current trace projection: agent-trace's TraceService, which sits above the agent runtime. */
export interface TraceProjectionSource {
  getSession(sessionId: string): Promise<TraceSessionResult>;
}

let projectionSource: TraceProjectionSource | null = null;

/** Wired once by the process composition root (src/main/index.ts) before any turn runs. */
export function bindTraceProjectionSource(source: TraceProjectionSource): void {
  projectionSource = source;
}

/** Coalesces task-driven trace refreshes without creating a second task projection path. */
export class TraceProjectionRefreshService {
  private readonly pending = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(private readonly deps: TraceProjectionRefreshDeps) {}

  schedule(sessionId: string): void {
    if (!sessionId || isSubagentScopeId(sessionId) || this.pending.has(sessionId)) {
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

export const traceProjectionRefreshService = new TraceProjectionRefreshService({
  getProjection: async (sessionId) => {
    if (!projectionSource) throw new Error('The trace projection source is not bound; src/main/index.ts binds it at startup.');
    return projectionSource.getSession(sessionId);
  },
  publish: (scope, presentation) => workflowProjectionPublisher.publishTraceProjectionChanged(scope, presentation),
});