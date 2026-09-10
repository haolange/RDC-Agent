import { withResourceLifetime } from '../../runtime/ResourceExecutionLifetime';
import { canonicalRealpath } from '../../hooks/hookTrustFingerprint';

export function toolResourceKey(projectRoot: string | null | undefined, sessionId: string): string {
  const canonical = projectRoot ? canonicalRealpath(projectRoot) : '';
  return canonical ? `project::${process.platform === 'win32' ? canonical.toLowerCase() : canonical}` : `session::${sessionId.split('::subagent::', 1)[0]}`;
}

/**
 * Serializes unsafe tool effects within one session/project resource scope.
 * Safe reads share a claim and exclude unsafe effects. The subagent dispatcher is orchestration,
 * so it is intentionally excluded by the caller; child effects acquire here.
 */
type Scope = { quarantined: number; readers: number; writer: boolean; queue: Array<{ shared: boolean; grant: () => void }> };

export class ToolResourceArbiter {
  private readonly scopes = new Map<string, Scope>();

  runShared<T>(key: string, signal: AbortSignal | undefined, operation: () => Promise<T>): Promise<T> {
    return this.run(key, false, signal, operation);
  }

  async runExclusive<T>(key: string, signal: AbortSignal | undefined, operation: () => Promise<T>): Promise<T> {
    // Project paths do not prove shell/MCP effects are disjoint. Keep all unsafe effects serial.
    return this.run(key, true, signal, () => this.run('unsafe-effects::global', true, signal, operation));
  }

  private async run<T>(key: string, exclusive: boolean, signal: AbortSignal | undefined, operation: () => Promise<T>): Promise<T> {
    if (signal?.aborted) throw new DOMException('The operation was aborted', 'AbortError');
    const scope = this.scopes.get(key) ?? { quarantined: 0, readers: 0, writer: false, queue: [] };
    if (scope.quarantined > 0) throw new Error('Resource quarantined: process exit has not been observed.');
    this.scopes.set(key, scope);
    await this.acquire(scope, exclusive, signal);
    const retained = new Set<Promise<unknown>>();
    const release = () => {
      if (exclusive) scope.writer = false; else scope.readers -= 1;
      this.drain(scope);
      if (!scope.writer && scope.readers === 0 && scope.queue.length === 0) this.scopes.delete(key);
    };
    try {
      if (signal?.aborted) throw new DOMException('The operation was aborted', 'AbortError');
      return await withResourceLifetime(retained, operation);
    } finally {
      if (retained.size === 0) release();
      else {
        scope.quarantined += 1;
        void Promise.all([...retained]).then(() => { scope.quarantined -= 1; release(); }, () => { /* Unknown exit retains ownership. */ });
      }
    }
  }

  private acquire(scope: Scope, exclusive: boolean, signal?: AbortSignal): Promise<void> {
    const canStart = exclusive ? !scope.writer && scope.readers === 0 : !scope.writer && !scope.queue.some((x) => !x.shared);
    if (canStart) { if (exclusive) scope.writer = true; else scope.readers += 1; return Promise.resolve(); }
    if (signal?.aborted) return Promise.reject(new DOMException('The operation was aborted', 'AbortError'));
    return new Promise<void>((resolve, reject) => {
      const entry = { shared: !exclusive, grant: resolve };
      const abort = () => { const index = scope.queue.indexOf(entry); if (index >= 0) scope.queue.splice(index, 1); this.drain(scope); reject(new DOMException('The operation was aborted', 'AbortError')); };
      signal?.addEventListener('abort', abort, { once: true });
      entry.grant = () => { signal?.removeEventListener('abort', abort); resolve(); };
      scope.queue.push(entry);
    });
  }

  private drain(scope: Scope): void {
    if (scope.writer) return;
    if (scope.readers === 0 && scope.queue[0] && !scope.queue[0].shared) {
      scope.queue.shift()!.grant(); scope.writer = true; return;
    }
    if (scope.readers > 0 && scope.queue[0] && !scope.queue[0].shared) return;
    while (scope.queue[0]?.shared && !scope.writer) { scope.queue.shift()!.grant(); scope.readers += 1; }
  }
}

export const toolResourceArbiter = new ToolResourceArbiter();
