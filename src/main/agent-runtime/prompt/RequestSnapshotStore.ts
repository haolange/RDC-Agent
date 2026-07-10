import fs from 'fs';
import path from 'path';
import type { RequestEnvelopeSnapshot } from '@shared/types/rdxRuntime';
import { appPathService } from '../../runtime/AppPathService';

const safeSegment = (value: string): string => value.replace(/[^a-zA-Z0-9._-]/g, '-');

export class RequestSnapshotStore {
  constructor(private readonly rootPath = appPathService.getAppStatePaths().llmCallsPath) {}

  nextCallIndex(sessionId: string | undefined, turnId: string | undefined): number {
    const dir = this.turnPath(sessionId, turnId);
    if (!fs.existsSync(dir)) return 1;
    return fs.readdirSync(dir).filter((entry) => entry.endsWith('.json')).length + 1;
  }

  write(snapshot: RequestEnvelopeSnapshot): void {
    const dir = this.turnPath(snapshot.sessionId, snapshot.turnId);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${String(snapshot.callIndex).padStart(3, '0')}-${safeSegment(snapshot.id)}.json`), `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
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
