import fs from 'fs';
import path from 'path';
import type { AgentRun, TraceEvent } from '@shared/types/agenticTrace';
import { appendJsonl, readJsonl, writeJsonl } from '@shared/utils/jsonl';
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

  private nextSeq(runId: string): number {
    const current = this.seqCounters.get(runId);
    if (current !== undefined) {
      const next = current + 1;
      this.seqCounters.set(runId, next);
      return next;
    }
    const events = this.getEvents(runId);
    const seq = events.length > 0 ? Math.max(...events.map((e) => e.seq)) + 1 : 1;
    this.seqCounters.set(runId, seq);
    return seq;
  }

  append(
    runId: string,
    type: TraceEvent['type'],
    payload: unknown,
    visibility: TraceEvent['visibility'] = 'user',
  ): TraceEvent {
    const event: TraceEvent = {
      eventId: generateEventId('trace'),
      runId,
      seq: this.nextSeq(runId),
      timestamp: nowIso(),
      type,
      payload,
      visibility,
    };
    appendJsonl(this.eventsPath(runId), event);
    return event;
  }

  getEvents(runId: string, afterSeq = 0): TraceEvent[] {
    return readJsonl<TraceEvent>(this.eventsPath(runId))
      .filter((event) => event.seq > afterSeq)
      .sort((a, b) => a.seq - b.seq);
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
