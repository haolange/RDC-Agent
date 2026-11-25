import { AsyncLocalStorage } from 'node:async_hooks';
import fs from 'node:fs';
import path from 'node:path';
import { appPathService } from './AppPathService';
import { hashScopedResource } from './ScopedResourceResolver';
import type { AgentPermissionSettings } from '@shared/types/settings';

/** Who asked: the desktop window, the unpackaged Browser QA bridge, or main itself. */
export type AuditOrigin = 'desktop' | 'browser-qa' | 'runtime';

export type AuditEvent =
  | { kind: 'ipc'; channel: string; argumentsSha256: string; outcome: 'requested' | 'ok' | 'error'; errorCode?: string }
  | {
    kind: 'tool-decision';
    decidedBy: 'user' | 'auto-review' | 'policy';
    approved: boolean;
    tool: string;
    toolCallId: string;
    argumentsSha256: string;
    risk?: 'low' | 'medium' | 'high';
    sessionId?: string | null;
    turnId?: string;
    reason?: string;
  }
  | { kind: 'permission-settings'; from: AgentPermissionSettings; to: AgentPermissionSettings };

export type AuditRecord = AuditEvent & { at: string; origin: AuditOrigin };

const originStorage = new AsyncLocalStorage<AuditOrigin>();

export function runWithAuditOrigin<T>(origin: AuditOrigin, work: () => T): T {
  return originStorage.run(origin, work);
}

export function currentAuditOrigin(): AuditOrigin {
  return originStorage.getStore() ?? 'runtime';
}

/** Arguments are fingerprinted, never stored: the log proves what was decided without holding inputs. */
export function auditArgumentsHash(value: unknown): string {
  return hashScopedResource(value ?? null);
}

/** The decision was not recorded, so the action it describes must not happen. */
export class AuditWriteFailedError extends Error {
  readonly code = 'AUDIT_WRITE_FAILED';

  constructor(cause: unknown) {
    super(`AUDIT_WRITE_FAILED: the security audit log could not be written (${cause instanceof Error ? cause.message : String(cause)}); the action was not performed.`, { cause });
  }
}

/**
 * Append-only record of security decisions under `<userData>/state/audit.jsonl`: permission changes,
 * tool approvals and denials, and every high-impact IPC call with its origin. Nothing rewrites or
 * trims it. Recording comes before the effect: a failed append throws `AuditWriteFailedError`, and
 * the caller does not perform the action the record would have described.
 */
export class AuditLog {
  constructor(private readonly explicitPath?: string) {}

  get filePath(): string {
    return this.explicitPath ?? path.join(appPathService.getAppStatePaths().appStateRoot, 'audit.jsonl');
  }

  record(event: AuditEvent): void {
    const record: AuditRecord = { at: new Date().toISOString(), origin: currentAuditOrigin(), ...event };
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      fs.appendFileSync(this.filePath, `${JSON.stringify(record)}\n`, { encoding: 'utf8', flag: 'a' });
    } catch (error) {
      throw new AuditWriteFailedError(error);
    }
  }
}

export const auditLog = new AuditLog();
