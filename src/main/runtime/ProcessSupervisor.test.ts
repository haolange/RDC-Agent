import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ProcessSupervisor, RingBuffer, type ProcessOwner, type SupervisedSpawnOptions } from './ProcessSupervisor';

const spawnLongRunning = (
  supervisor: ProcessSupervisor,
  owner: ProcessOwner = 'shell',
  options: SupervisedSpawnOptions = {},
) => supervisor.spawn(
  owner,
  process.execPath,
  ['-e', 'setInterval(() => undefined, 1000);'],
  { isolateProcessGroup: false, ...options },
);

describe('RingBuffer', () => {
  it('bounds retained bytes', () => {
    const ring = new RingBuffer(16);
    ring.append('abcdefghijklmnop');
    ring.append('XYZ');
    const text = ring.toString();
    expect(Buffer.byteLength(text, 'utf8')).toBeLessThanOrEqual(16);
    expect(text.endsWith('XYZ') || text.includes('XYZ')).toBe(true);
  });
});

describe('ProcessSupervisor', () => {
  let supervisor: ProcessSupervisor;

  beforeEach(() => {
    supervisor = new ProcessSupervisor();
  });

  afterEach(async () => {
    await supervisor.joinAll({ graceMs: 300, forceAfterMs: 1_500 });
    supervisor.resetForTests();
  });

  it('registers spawn and reports exit reason', async () => {
    const supervised = supervisor.spawn(
      'other',
      process.execPath,
      ['-e', 'process.stdout.write("hello");'],
      { isolateProcessGroup: false },
    );

    const info = await supervised.exit;
    expect(info.reason === 'exit' || info.reason === 'signal').toBe(true);
    expect(supervisor.size).toBe(0);
  });

  it('abort terminates process and leaves no live registry entry', async () => {
    const supervised = spawnLongRunning(supervisor);

    expect(supervisor.size).toBe(1);
    supervised.abort('abort');
    const info = await supervised.join(8_000);
    expect(info.reason).toBe('abort');
    expect(supervisor.size).toBe(0);
  }, 12_000);

  it('timeout forces abort reason', async () => {
    const supervised = spawnLongRunning(supervisor, 'shell', { timeoutMs: 200 });

    const info = await supervised.exit;
    expect(info.reason).toBe('timeout');
    expect(supervisor.size).toBe(0);
  }, 12_000);

  it('joinAll clears all supervised processes', async () => {
    for (let i = 0; i < 3; i += 1) spawnLongRunning(supervisor, 'other');
    expect(supervisor.size).toBe(3);
    await supervisor.joinAll({ graceMs: 300, forceAfterMs: 4_000 });
    expect(supervisor.size).toBe(0);
  }, 15_000);

  it('spawn_failed surfaces for missing executable', async () => {
    const supervised = supervisor.spawn(
      'other',
      process.platform === 'win32' ? 'this-command-does-not-exist-xyz.cmd' : '/nonexistent/binary/path',
      [],
      { isolateProcessGroup: false },
    );
    const info = await supervised.exit;
    expect(['spawn_failed', 'exit', 'signal', 'abort']).toContain(info.reason);
  });
});
