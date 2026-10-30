import type { AgentPermissionMode } from '@shared/types/settings';
import type { RuntimePermissionState } from '@shared/types/runtimePermission';

export class PermissionModeChangedError extends Error {
  constructor() { super('PERMISSION_MODE_CHANGED'); this.name = 'PermissionModeChangedError'; }
}

/** Main-owned live mode. Other execution constraints remain frozen on the plan. */
export class RuntimePermissionStateService {
  private snapshot: RuntimePermissionState | null = null;
  private readonly listeners = new Set<(state: RuntimePermissionState) => void>();

  initialize(mode: AgentPermissionMode): RuntimePermissionState {
    this.snapshot ??= Object.freeze({ mode, revision: 1 });
    return this.snapshot;
  }

  getSnapshot(): RuntimePermissionState {
    if (!this.snapshot) throw new Error('PERMISSION_STATE_UNINITIALIZED');
    return this.snapshot;
  }

  commitMode(mode: AgentPermissionMode): RuntimePermissionState {
    const previous = this.getSnapshot();
    if (previous.mode === mode) return previous;
    this.snapshot = Object.freeze({ mode, revision: previous.revision + 1 });
    for (const listener of [...this.listeners]) {
      try { listener(this.snapshot); } catch { /* Committed state cannot be rolled back by observers. */ }
    }
    return this.snapshot;
  }

  subscribe(listener: (state: RuntimePermissionState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

export const runtimePermissionStateService = new RuntimePermissionStateService();
