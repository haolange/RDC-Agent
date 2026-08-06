import { BrowserWindow } from 'electron';
import type {
  RuntimeLogEntry,
  RuntimeLogNamespace,
  RuntimeLogScope,
  RuntimeLogSeverity,
} from '@shared/types/runtimeLog';
import { generateEventId, nowMs } from '@shared/utils/id';
import { rendererEventHub } from '../browserAppBridge/rendererEventHub';
import { redactCredentialLikeText, redactSecretsDeep } from './secretRedaction';

const APP_LOG_LIMIT = 1000;
const SESSION_LOG_LIMIT = 500;
/** Per-entry serialized size hard cap (title+summary+detail+raw). */
export const MAX_ENTRY_BYTES = 64 * 1024;

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

function truncateUtf8(text: string, maxBytes: number): string {
  if (maxBytes <= 0) return '';
  const buf = Buffer.from(text, 'utf8');
  if (buf.byteLength <= maxBytes) return text;
  let end = Math.max(0, maxBytes - Buffer.byteLength('…[truncated]', 'utf8'));
  while (end > 0 && (buf[end] & 0xc0) === 0x80) end -= 1;
  return `${buf.subarray(0, end).toString('utf8')}…[truncated]`;
}

function clampEntryFields(input: RuntimeLogInput): Pick<
  RuntimeLogEntry,
  'title' | 'summary' | 'detail' | 'raw'
> {
  const redactedTitle = redactCredentialLikeText(input.title);
  const redactedSummary = redactCredentialLikeText(input.summary);
  const redactedDetail = input.detail !== undefined
    ? redactCredentialLikeText(input.detail)
    : undefined;
  const redactedRaw = input.raw === undefined || input.raw === null
    ? input.raw ?? null
    : redactSecretsDeep(input.raw, 'raw').value;

  let title = truncateUtf8(redactedTitle, 4 * 1024);
  let summary = truncateUtf8(redactedSummary, 8 * 1024);
  let detail = redactedDetail !== undefined ? truncateUtf8(redactedDetail, 16 * 1024) : undefined;
  let raw: unknown = redactedRaw ?? null;
  let rawJson = '';
  try {
    rawJson = raw === null || raw === undefined ? '' : JSON.stringify(raw);
  } catch {
    raw = { truncated: true, reason: 'unserializable' };
    rawJson = JSON.stringify(raw);
  }
  const fixed = Buffer.byteLength(title, 'utf8')
    + Buffer.byteLength(summary, 'utf8')
    + Buffer.byteLength(detail ?? '', 'utf8');
  const rawBudget = Math.max(0, MAX_ENTRY_BYTES - fixed - 64);
  if (Buffer.byteLength(rawJson, 'utf8') > rawBudget) {
    raw = {
      truncated: true,
      preview: truncateUtf8(rawJson, Math.max(0, rawBudget - 48)),
    };
  }
  // Final guard: shrink detail if still over.
  const measure = (): number => {
    try {
      return Buffer.byteLength(JSON.stringify({ title, summary, detail, raw }), 'utf8');
    } catch {
      return MAX_ENTRY_BYTES + 1;
    }
  };
  if (measure() > MAX_ENTRY_BYTES && detail) {
    detail = truncateUtf8(detail, Math.max(0, MAX_ENTRY_BYTES - fixed + Buffer.byteLength(detail, 'utf8') - 256));
  }
  if (measure() > MAX_ENTRY_BYTES) {
    raw = { truncated: true };
    summary = truncateUtf8(summary, 1024);
    title = truncateUtf8(title, 512);
    detail = undefined;
  }
  return { title, summary, detail, raw };
}

export class RuntimeLogService {
  private appEntries: RuntimeLogEntry[] = [];
  private sessionEntries = new Map<string, RuntimeLogEntry[]>();

  log(input: RuntimeLogInput): RuntimeLogEntry {
    const clamped = clampEntryFields(input);
    const entry: RuntimeLogEntry = {
      id: generateEventId('rlog'),
      timestamp: input.timestamp ?? nowMs(),
      scope: input.scope,
      namespace: input.namespace,
      severity: input.severity ?? 'info',
      title: clamped.title,
      summary: clamped.summary,
      detail: clamped.detail,
      sessionId: input.sessionId ?? null,
      projectId: input.projectId ?? null,
      runId: input.runId ?? null,
      raw: clamped.raw ?? null,
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
    rendererEventHub.emit('runtime:logAppended', entry);
    const windows = BrowserWindow.getAllWindows();
    for (const win of windows) {
      if (!win.isDestroyed()) {
        win.webContents.send('runtime:logAppended', entry);
      }
    }
  }
}

export const runtimeLogService = new RuntimeLogService();
