import { BrowserWindow } from 'electron';
import type {
  RuntimeLogEntry,
  RuntimeLogNamespace,
  RuntimeLogScope,
  RuntimeLogSeverity,
} from '@shared/types/runtimeLog';
import { generateEventId, nowMs } from '@shared/utils/id';

const APP_LOG_LIMIT = 1000;
const SESSION_LOG_LIMIT = 500;

interface RuntimeLogInput {
  scope: RuntimeLogScope;
  namespace: RuntimeLogNamespace;
  severity?: RuntimeLogSeverity;
  title: string;
  summary: string;
  detail?: string;
  sessionId?: string | null;
  projectId?: string | null;
  runId?: string | null;
  raw?: unknown;
  timestamp?: number;
}

export class RuntimeLogService {
  private appEntries: RuntimeLogEntry[] = [];
  private sessionEntries = new Map<string, RuntimeLogEntry[]>();

  log(input: RuntimeLogInput): RuntimeLogEntry {
    const entry: RuntimeLogEntry = {
      id: generateEventId('rlog'),
      timestamp: input.timestamp ?? nowMs(),
      scope: input.scope,
      namespace: input.namespace,
      severity: input.severity ?? 'info',
      title: input.title,
      summary: input.summary,
      detail: input.detail,
      sessionId: input.sessionId ?? null,
      projectId: input.projectId ?? null,
      runId: input.runId ?? null,
      raw: input.raw ?? null,
    };

    this.pushWithLimit(this.appEntries, entry, APP_LOG_LIMIT);
    if (entry.sessionId) {
      const bucket = this.sessionEntries.get(entry.sessionId) ?? [];
      this.pushWithLimit(bucket, entry, SESSION_LOG_LIMIT);
      this.sessionEntries.set(entry.sessionId, bucket);
    }

    this.broadcast(entry);
    return entry;
  }

  list(scope: RuntimeLogScope, sessionId?: string | null): RuntimeLogEntry[] {
    if (scope === 'session') {
      if (!sessionId) {
        return [];
      }
      return [...(this.sessionEntries.get(sessionId) ?? [])];
    }

    return [...this.appEntries];
  }

  private pushWithLimit(target: RuntimeLogEntry[], entry: RuntimeLogEntry, limit: number): void {
    target.push(entry);
    if (target.length > limit) {
      target.splice(0, target.length - limit);
    }
  }

  private broadcast(entry: RuntimeLogEntry): void {
    const windows = BrowserWindow.getAllWindows();
    for (const win of windows) {
      if (!win.isDestroyed()) {
        win.webContents.send('runtime:logAppended', entry);
      }
    }
  }
}

export const runtimeLogService = new RuntimeLogService();
