import fs from 'fs';
import path from 'path';
import type { PromptPlan, RequestEnvelopeSnapshot } from '@shared/types/rdcRuntime';
import { appPathService } from '../../runtime/AppPathService';

const safeSegment = (value: string): string => value.replace(/[^a-zA-Z0-9._-]/g, '-');

export class RequestSnapshotStore {
  private readonly promptSegmentsCache = new Map<string, { stamp: string; segments: PromptPlan['segments'] }>();
  private readonly mailboxDeliveriesCache = new Map<string, { stamp: string; deliveries: NonNullable<RequestEnvelopeSnapshot['mailboxDeliveries']> }>();

  constructor(private readonly explicitRootPath?: string) {}

  private get rootPath(): string {
    return this.explicitRootPath ?? appPathService.getAppStatePaths().llmCallsPath;
  }

  nextCallIndex(sessionId: string | undefined, turnId: string | undefined): number {
    const dir = this.turnPath(sessionId, turnId);
    if (!fs.existsSync(dir)) return 1;
    return fs.readdirSync(dir).filter((entry) => entry.endsWith('.json')).length + 1;
  }

  write(snapshot: RequestEnvelopeSnapshot): void {
    const dir = this.turnPath(snapshot.sessionId, snapshot.turnId);
    fs.mkdirSync(dir, { recursive: true });
    const name = `${String(snapshot.callIndex).padStart(3, '0')}-${safeSegment(snapshot.id)}`;
    fs.writeFileSync(path.join(dir, `${name}.json`), `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
    // The right rail needs only the frozen PromptPlan segments. Keep a bounded
    // projection beside the full request so refreshing the rail never parses
    // every large message transcript in a long session.
    fs.writeFileSync(path.join(dir, 'prompt-segments.meta'), JSON.stringify(snapshot.promptPlan.segments), 'utf8');
    fs.writeFileSync(path.join(dir, `${name}.mailbox.meta`), JSON.stringify(snapshot.mailboxDeliveries ?? []), 'utf8');
  }

  listPromptSegments(sessionId: string): PromptPlan['segments'] {
    const base = path.join(this.rootPath, safeSegment(sessionId));
    if (!fs.existsSync(base)) return [];
    const segments: PromptPlan['segments'] = [];
    for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dir = path.join(base, entry.name);
      const meta = path.join(dir, 'prompt-segments.meta');
      // Older request snapshots have no compact projection. Read only the
      // first request of that turn; PromptPlan is frozen for the entire turn.
      const source = fs.existsSync(meta)
        ? meta
        : fs.readdirSync(dir).filter((name) => name.endsWith('.json')).sort()[0];
      if (!source) continue;
      const file = source === meta ? meta : path.join(dir, source);
      const stat = fs.statSync(file);
      const stamp = `${stat.size}:${stat.mtimeMs}`;
      let cached = this.promptSegmentsCache.get(file);
      if (!cached || cached.stamp !== stamp) {
        const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as PromptPlan['segments'] | RequestEnvelopeSnapshot;
        const values = Array.isArray(parsed) ? parsed : parsed.promptPlan.segments;
        if (!Array.isArray(values)) throw new Error(`Request snapshot lacks PromptPlan segments: ${file}`);
        cached = { stamp, segments: values };
        this.promptSegmentsCache.set(file, cached);
      }
      segments.push(...cached.segments);
    }
    return segments;
  }

  listMailboxDeliveries(sessionId: string): NonNullable<RequestEnvelopeSnapshot['mailboxDeliveries']> {
    const base = path.join(this.rootPath, safeSegment(sessionId));
    if (!fs.existsSync(base)) return [];
    const deliveries: NonNullable<RequestEnvelopeSnapshot['mailboxDeliveries']> = [];
    for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dir = path.join(base, entry.name);
      for (const name of fs.readdirSync(dir).filter((value) => value.endsWith('.json'))) {
        const snapshotFile = path.join(dir, name);
        const metaFile = path.join(dir, `${name.slice(0, -5)}.mailbox.meta`);
        const file = fs.existsSync(metaFile) ? metaFile : snapshotFile;
        const stat = fs.statSync(file);
        const stamp = `${stat.size}:${stat.mtimeMs}`;
        let cached = this.mailboxDeliveriesCache.get(file);
        if (!cached || cached.stamp !== stamp) {
          // Legacy snapshots are parsed one at a time; never retain their
          // conversation messages merely to recover mailbox commits.
          const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as RequestEnvelopeSnapshot | NonNullable<RequestEnvelopeSnapshot['mailboxDeliveries']>;
          const values = Array.isArray(parsed) ? parsed : parsed.mailboxDeliveries ?? [];
          if (!Array.isArray(values)) throw new Error(`Request snapshot lacks mailbox deliveries: ${file}`);
          cached = { stamp, deliveries: values };
          this.mailboxDeliveriesCache.set(file, cached);
        }
        deliveries.push(...cached.deliveries);
      }
    }
    return deliveries;
  }

  complete(snapshotId: string, sessionId: string | undefined, turnId: string | undefined, usage: RequestEnvelopeSnapshot['usage']): void {
    const snapshotPath = this.findSnapshotPath(snapshotId, sessionId, turnId);
    if (!snapshotPath) return;
    const snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf8')) as RequestEnvelopeSnapshot;
    snapshot.completedAt = new Date().toISOString();
    snapshot.usage = usage;
    fs.writeFileSync(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
  }

  list(sessionId: string, turnId?: string): RequestEnvelopeSnapshot[] {
    const base = turnId ? this.turnPath(sessionId, turnId) : path.join(this.rootPath, safeSegment(sessionId));
    if (!fs.existsSync(base)) return [];
    const files: string[] = [];
    const walk = (dir: string) => fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
      const target = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(target);
      else if (entry.isFile() && entry.name.endsWith('.json')) files.push(target);
    });
    walk(base);
    return files.map((file) => JSON.parse(fs.readFileSync(file, 'utf8')) as RequestEnvelopeSnapshot)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.callIndex - right.callIndex);
  }

  get(sessionId: string, turnId: string, snapshotId: string): RequestEnvelopeSnapshot | null {
    const snapshotPath = this.findSnapshotPath(snapshotId, sessionId, turnId);
    return snapshotPath ? JSON.parse(fs.readFileSync(snapshotPath, 'utf8')) as RequestEnvelopeSnapshot : null;
  }

  private turnPath(sessionId?: string, turnId?: string): string {
    return path.join(this.rootPath, safeSegment(sessionId || 'no-session'), safeSegment(turnId || 'no-turn'));
  }

  private findSnapshotPath(snapshotId: string, sessionId?: string, turnId?: string): string | null {
    const dir = this.turnPath(sessionId, turnId);
    if (!fs.existsSync(dir)) return null;
    const suffix = `-${safeSegment(snapshotId)}.json`;
    const fileName = fs.readdirSync(dir).find((entry) => entry.endsWith(suffix));
    return fileName ? path.join(dir, fileName) : null;
  }
}

export const requestSnapshotStore = new RequestSnapshotStore();
