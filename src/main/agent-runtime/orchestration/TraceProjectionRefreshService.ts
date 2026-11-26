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

/**
 * Coalesces task-driven trace refreshes without creating a second task projection path. One build runs per session
 * at a time: a refresh asked for while one is building runs once after it, so an older build never publishes over a
 * newer one.
 */
export class TraceProjectionRefreshService {
  private readonly pending = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly building = new Set<string>();
  private readonly again = new Set<string>();

  constructor(private readonly deps: TraceProjectionRefreshDeps) {}

  schedule(sessionId: string): void {
    if (!sessionId || isSubagentScopeId(sessionId) || this.pending.has(sessionId)) {
      return;
    }
    const timer = setTimeout(() => {
      this.pending.delete(sessionId);
      this.build(sessionId);
    }, 40);
    this.pending.set(sessionId, timer);
  }

  clear(sessionId: string): void {
    this.again.delete(sessionId);
    const timer = this.pending.get(sessionId);
    if (!timer) return;
    clearTimeout(timer);
    this.pending.delete(sessionId);
  }

  private build(sessionId: string): void {
    if (this.building.has(sessionId)) {
      this.again.add(sessionId);
      return;
    }
    this.building.add(sessionId);
    void this.flush(sessionId).finally(() => {
      this.building.delete(sessionId);
      if (this.again.delete(sessionId)) this.build(sessionId);
    });
  }

  private async flush(sessionId: string): Promise<void> {
    try {
      const { presentation } = await this.deps.getProjection(sessionId);
      this.deps.publish({ projectId: presentation.projectId, sessionId }, presentation);
    } catch (error) {
      console.error('[TraceProjectionRefresh] Failed to refresh task projection:', error);
    }
  }
}

export const traceProjectionRefreshService = new TraceProjectionRefreshService({
  getProjection: async (sessionId) => {
    if (!projectionSource)
      throw new Error('The trace projection source is not bound; src/main/index.ts binds it at startup.');
    return projectionSource.getSession(sessionId);
  },
  publish: (scope, presentation) => workflowProjectionPublisher.publishTraceProjectionChanged(scope, presentation),
});
