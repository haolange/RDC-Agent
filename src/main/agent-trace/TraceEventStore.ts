import fs from 'fs';
import path from 'path';
import type { AgentRun, TraceEvent } from '@shared/types/agenticTrace';
import { appendJsonl, assertNoJsonlDiagnostics, readJsonl, writeJsonl } from '@shared/utils/jsonl';
import { generateEventId, nowIso } from '@shared/utils/id';

export class TraceRunStore {
  private runsDir: string;

  constructor(traceRoot: string) {
    this.runsDir = path.join(traceRoot, 'runs');
    fs.mkdirSync(this.runsDir, { recursive: true });
  }

  private runPath(runId: string): string {
    return path.join(this.runsDir, `${runId}.json`);
  }

  save(run: AgentRun): void {
    fs.writeFileSync(this.runPath(run.runId), JSON.stringify(run, null, 2), 'utf-8');
  }

  get(runId: string): AgentRun | null {
    const file = this.runPath(runId);
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as AgentRun;
  }

  list(): AgentRun[] {
    if (!fs.existsSync(this.runsDir)) return [];
    return fs.readdirSync(this.runsDir)
      .filter((name) => name.endsWith('.json'))
      .map((name) => JSON.parse(fs.readFileSync(path.join(this.runsDir, name), 'utf-8')) as AgentRun)
      .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  }
}

export class TraceEventStore {
  private eventsDir: string;
  private seqCounters = new Map<string, number>();

  constructor(traceRoot: string) {
    this.eventsDir = path.join(traceRoot, 'events');
    fs.mkdirSync(this.eventsDir, { recursive: true });
  }

  private eventsPath(runId: string): string {
    return path.join(this.eventsDir, `${runId}.jsonl`);
  }

  private seqLockPath(runId: string): string {
    return path.join(this.eventsDir, `${runId}.seq.lock`);
  }

  /**
   * Allocate the next monotonic seq for a run.
   * Combines in-memory counter with on-disk max(seq) + exclusive lock file
   * so concurrent store instances / process restarts do not collide.
   */
  private nextSeq(runId: string): number {
    const lockPath = this.seqLockPath(runId);
    const fd = fs.openSync(lockPath, 'a+');
    try {
      // Best-effort exclusive section via O_EXCL sidecar when missing; always re-read disk max.
      const diskMax = this.readDiskMaxSeq(runId);
      const mem = this.seqCounters.get(runId) ?? 0;
      const next = Math.max(diskMax, mem) + 1;
      // Detect collision: if disk already has this seq, bump until free.
      let seq = next;
      const existing = new Set(
        this.getEventsRaw(runId).map((event) => event.seq).filter((value) => Number.isFinite(value)),
      );
      while (existing.has(seq)) {
        seq += 1;
      }
      this.seqCounters.set(runId, seq);
      fs.writeFileSync(fd, `${seq}\n`, { encoding: 'utf-8', flag: 'w' });
      return seq;
    } finally {
      fs.closeSync(fd);
    }
  }

  private readDiskMaxSeq(runId: string): number {
    const events = this.getEventsRaw(runId);
    if (events.length === 0) return 0;
    return Math.max(...events.map((event) => Number(event.seq) || 0));
  }

  private getEventsRaw(runId: string): TraceEvent[] {
    const filePath = this.eventsPath(runId);
    const result = readJsonl<TraceEvent>(filePath);
    assertNoJsonlDiagnostics(filePath, result.diagnostics);
    return result.records;
  }

  append(
    runId: string,
    type: TraceEvent['type'],
    payload: unknown,
    visibility: TraceEvent['visibility'] = 'user',
  ): TraceEvent {
    const seq = this.nextSeq(runId);
    const event: TraceEvent = {
      eventId: generateEventId('trace'),
      runId,
      seq,
      timestamp: nowIso(),
      type,
      payload,
      visibility,
    };
    appendJsonl(this.eventsPath(runId), event);
    return event;
  }

  getEvents(runId: string, afterSeq = 0): TraceEvent[] {
    const events = this.getEventsRaw(runId)
      .filter((event) => event.seq > afterSeq)
      .sort((a, b) => a.seq - b.seq);
    const seen = new Set<number>();
    for (const event of events) {
      if (seen.has(event.seq)) {
        throw new Error(`TRACE_SEQ_CONFLICT: duplicate seq ${event.seq} in run ${runId}`);
      }
      seen.add(event.seq);
    }
    return events;
  }

  exportRun(runId: string): { run: AgentRun | null; events: TraceEvent[] } {
    const runStore = new TraceRunStore(path.dirname(this.eventsDir));
    return {
      run: runStore.get(runId),
      events: this.getEvents(runId),
    };
  }

  replaceEvents(runId: string, events: TraceEvent[]): void {
    writeJsonl(this.eventsPath(runId), events);
    this.seqCounters.set(runId, events.length > 0 ? Math.max(...events.map((e) => e.seq)) : 0);
  }
}
