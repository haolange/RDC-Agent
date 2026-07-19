import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { TraceEventEmitter } from './TraceEventEmitter';
import { TraceEventStore } from './TraceEventStore';

const roots: string[] = [];

function emitter() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-trace-channel-'));
  roots.push(root);
  const store = new TraceEventStore(root);
  return { emitter: new TraceEventEmitter(store), store };
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('TraceEventEmitter explicit thinking boundary', () => {
  it('creates thought nodes only from explicit readable ThinkingArtifact input', () => {
    const { emitter: traceEmitter, store } = emitter();
    traceEmitter.emitThinkingArtifact('run', {
      text: 'explicit reasoning',
      kind: 'raw',
      source: 'openai-compatible-raw',
      visibility: 'raw-collapsed',

      providerOutputRef: {
        protocol: 'openai-compatible',
        providerBlockKey: 'virtual:thinking',
        contentIndex: 1,
      },
    });
    expect(store.getEvents('run').map((event) => (event.payload as { kind?: string }).kind))
      .toEqual(['thought_summary']);
  });

  it('does not project hidden opaque artifacts', () => {
    const { emitter: traceEmitter, store } = emitter();
    expect(traceEmitter.emitThinkingArtifact('run', {
      kind: 'opaque',
      source: 'anthropic-redacted-thinking',
      visibility: 'hidden',

    })).toBeNull();
    expect(store.getEvents('run')).toEqual([]);
  });

  it('keeps identical thinking and final bytes when their explicit semantic sources differ', () => {
    const { emitter: traceEmitter, store } = emitter();
    traceEmitter.emitThinkingArtifact('run', {
      text: 'same bytes',
      kind: 'summary',
      source: 'openai-responses-summary',
      visibility: 'summary',

    });
    traceEmitter.emitFinalResponse('run', 'same bytes');

    const events = store.getEvents('run');
    expect(events.map((event) => (event.payload as { kind?: string }).kind))
      .toEqual(['thought_summary', 'final_response']);
  });
});
