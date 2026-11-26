import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { abnormalSupervisedExit, LifecycleLedger, type LifecycleEvent } from './LifecycleLedger';
import { ProcessSupervisor } from './ProcessSupervisor';

const turnStarted = (turnId: string): LifecycleEvent => ({
  kind: 'turn_started',
  sessionId: 'session-1',
  turnId,
  runId: null,
  providerId: 'provider',
  modelId: 'model',
});

describe('lifecycle ledger', () => {
  let root = '';
  const ledger = (instanceId = 'instance-a', options: { maxBytes?: number; home?: string } = {}) =>
    new LifecycleLedger({
      instanceId,
      directory: () => path.join(root, 'state', 'lifecycle'),
      maxBytes: options.maxBytes,
      pathPrefixes: () => [
        [root, '<userData>'],
        [options.home ?? '/home/someone', '~'],
      ],
    });

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-lifecycle-ledger-'));
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('stamps every record with the time and this launch, and reads one instance back', () => {
    const first = ledger('instance-a');
    const second = ledger('instance-b');
    expect(first.record(turnStarted('turn-1'))).toBe(true);
    expect(second.record({ kind: 'instance_exited', clean: true, exitCode: 0 })).toBe(true);

    const all = first.tail();
    expect(all.records.map((record) => [record.instanceId, record.kind])).toEqual([
      ['instance-a', 'turn_started'],
      ['instance-b', 'instance_exited'],
    ]);
    expect(Date.parse(all.records[0]!.at)).not.toBeNaN();
    expect(first.tail('instance-b').records).toHaveLength(1);
  });

  it('rotates at the cap into one previous generation and reads both', () => {
    const capped = ledger('instance-a', { maxBytes: 600 });
    for (let index = 0; index < 12; index += 1) capped.record(turnStarted(`turn-${index}`));

    const directory = path.join(root, 'state', 'lifecycle');
    expect(fs.readdirSync(directory).sort()).toEqual(['ledger.jsonl', 'ledger.previous.jsonl']);
    for (const name of fs.readdirSync(directory)) {
      expect(fs.statSync(path.join(directory, name)).size).toBeLessThanOrEqual(600);
    }
    const kept = capped.tail().records.map((record) => (record.kind === 'turn_started' ? record.turnId : ''));
    // Only the newest records survive a rotation past the previous generation, in order and without gaps.
    expect(kept.at(-1)).toBe('turn-11');
    const first = Number(kept[0]!.slice('turn-'.length));
    expect(kept).toEqual(Array.from({ length: 12 - first }, (_, index) => `turn-${first + index}`));
  });

  it('skips an interrupted final append and counts damaged lines', () => {
    const writer = ledger();
    writer.record(turnStarted('turn-1'));
    fs.appendFileSync(writer.filePath, '{"kind":"turn_finished","at":"2026', 'utf8');
    expect(writer.tail()).toMatchObject({ records: [{ turnId: 'turn-1' }], damaged: 0 });

    // The next record sets the torn bytes aside and lands on a record boundary.
    writer.record({ kind: 'instance_exited', clean: false, exitCode: 1 });
    fs.appendFileSync(writer.filePath, '{"kind":"instance_started","schema":"other"}\n', 'utf8');
    const tail = writer.tail();
    expect(tail.records.map((record) => record.kind)).toEqual(['turn_started', 'instance_exited']);
    expect(tail.damaged).toBe(1);
  });

  it('writes no credential and no home or data directory, and fingerprints the scrubbed stack', () => {
    const home = path.join(root, 'home', 'alice');
    const writer = ledger('instance-a', { home });
    const secret = `sk-${'a1B2'.repeat(8)}`;
    const fault = new Error(`provider rejected key ${secret} for ${home}/project`);
    fault.stack = `Error: provider rejected key ${secret}\n    at load (${root}/state/x.js:1:2)\n    at run (${home}/app/main.js:3:4)`;

    expect(writer.recordFault('uncaughtException', fault)).toBe(true);
    const text = fs.readFileSync(writer.filePath, 'utf8');
    expect(text).not.toContain(secret);
    expect(text).not.toContain(home);
    expect(text).not.toContain(root);
    const [record] = writer.tail().records;
    expect(record).toMatchObject({
      kind: 'fault',
      fault: 'uncaughtException',
      message: 'provider rejected key [REDACTED] for ~/project',
    });
    expect(record?.kind === 'fault' ? record.stack : '').toContain('at load (<userData>/state/x.js:1:2)');
    expect(record?.kind === 'fault' ? record.stack : '').toContain('at run (~/app/main.js:3:4)');

    // The same fault on another machine has the same fingerprint once its paths are scrubbed.
    const otherRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-lifecycle-ledger-other-'));
    try {
      const other = new LifecycleLedger({
        instanceId: 'instance-b',
        directory: () => path.join(otherRoot, 'lifecycle'),
        pathPrefixes: () => [
          [otherRoot, '<userData>'],
          ['/Users/bob', '~'],
        ],
      });
      const twin = new Error(`provider rejected key ${secret} for /Users/bob/project`);
      twin.stack = `Error: provider rejected key ${secret}\n    at load (${otherRoot}/state/x.js:1:2)\n    at run (/Users/bob/app/main.js:3:4)`;
      other.recordFault('uncaughtException', twin);
      const [twinRecord] = other.tail().records;
      expect(
        twinRecord?.kind === 'fault' && record?.kind === 'fault' && twinRecord.stackHash === record.stackHash,
      ).toBe(true);
    } finally {
      fs.rmSync(otherRoot, { recursive: true, force: true });
    }
  });

  it('refuses a record outside the schema without throwing', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const writer = ledger();
    const withPrompt = { ...turnStarted('turn-1'), prompt: 'what the user typed' } as unknown as LifecycleEvent;
    expect(writer.record(withPrompt)).toBe(false);
    expect(fs.existsSync(writer.filePath)).toBe(false);
    expect(errors).toHaveBeenCalledOnce();
  });

  it('keeps every record whole when producers append concurrently across rotations', async () => {
    const writers = [ledger('instance-a', { maxBytes: 64 * 1024 }), ledger('instance-b', { maxBytes: 64 * 1024 })];
    const producers = Array.from({ length: 40 }, async (_, producer) => {
      for (let index = 0; index < 10; index += 1) {
        await new Promise<void>((resolve) => setImmediate(resolve));
        writers[producer % 2]!.record(turnStarted(`p${producer}-t${index}`));
      }
    });
    await Promise.all(producers);

    const { records, damaged } = writers[0]!.tail();
    expect(damaged).toBe(0);
    const directory = path.join(root, 'state', 'lifecycle');
    const lines = fs
      .readdirSync(directory)
      .flatMap((name) => fs.readFileSync(path.join(directory, name), 'utf8').split('\n').filter(Boolean));
    expect(lines).toHaveLength(records.length);
    // Each producer's surviving records are in its own order.
    for (let producer = 0; producer < 40; producer += 1) {
      const own = records
        .filter((record) => record.kind === 'turn_started' && record.turnId.startsWith(`p${producer}-`))
        .map((record) => (record.kind === 'turn_started' ? Number(record.turnId.split('-t')[1]) : -1));
      expect(own).toEqual([...own].sort((a, b) => a - b));
    }
    expect(records.length).toBeGreaterThan(200);
  });

  it('records the abnormal exits a process supervisor settles, not the ones the app asked for', async () => {
    const writer = ledger();
    const supervisor = new ProcessSupervisor();
    supervisor.observeExits((owner, info) => {
      const event = abnormalSupervisedExit(owner, info);
      if (event) writer.record(event);
    });
    const idle = ['-e', 'setInterval(() => undefined, 1000);'];
    const fine = supervisor.spawn('shell', process.execPath, ['-e', 'process.exit(3)'], { isolateProcessGroup: false });
    const failingReplay = supervisor.spawn('replay', process.execPath, ['-e', 'process.exit(2)'], {
      isolateProcessGroup: false,
    });
    const timedOut = supervisor.spawn('shell', process.execPath, idle, { isolateProcessGroup: false, timeoutMs: 100 });
    await Promise.all([fine.exit, failingReplay.exit, timedOut.exit]);
    const lingering = supervisor.spawn('background', process.execPath, idle, { isolateProcessGroup: false });
    await supervisor.joinAll({ graceMs: 300, forceAfterMs: 4_000 });
    const terminated = await lingering.exit;
    expect(terminated.reason).toBe('supervisor_kill');

    expect(
      writer
        .tail()
        .records.map((record) =>
          record.kind === 'supervised_child_exited' ? [record.owner, record.reason, record.code] : record.kind,
        ),
    ).toEqual([
      ['replay', 'exit', 2],
      ['background', 'supervisor_kill', terminated.code],
    ]);
  }, 15_000);

  it('keeps a shell exiting non-zero and a requested abort out of the ledger', () => {
    const base = { code: null, signal: null, durationMs: 1 } as const;
    expect(abnormalSupervisedExit('shell', { ...base, reason: 'exit', code: 1 })).toBeNull();
    expect(abnormalSupervisedExit('mcp', { ...base, reason: 'abort' })).toBeNull();
    expect(abnormalSupervisedExit('mcp', { ...base, reason: 'signal', signal: 'SIGSEGV' })).toMatchObject({
      owner: 'mcp',
      reason: 'signal',
      signal: 'SIGSEGV',
    });
  });
});
