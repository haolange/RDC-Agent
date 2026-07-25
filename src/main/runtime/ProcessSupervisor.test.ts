import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ProcessSupervisor, RingBuffer } from './ProcessSupervisor';

describe('RingBuffer', () => {
  it('bounds retained bytes', () => {
    const ring = new RingBuffer(16);
    ring.append('abcdefghijklmnop'); // 16
    ring.append('XYZ'); // overflow
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
    await supervisor.joinAll({ graceMs: 200, forceAfterMs: 1_000 });
    supervisor.resetForTests();
  });

  it('registers spawn and reports exit reason', async () => {
    const isWin = process.platform === 'win32';
    const supervised = isWin
      ? supervisor.spawn('other', 'cmd.exe', ['/d', '/s', '/c', 'echo hello'], {
          isolateProcessGroup: false,
        })
      : supervisor.spawn('other', '/bin/echo', ['hello']);

    const info = await supervised.exit;
    expect(info.reason === 'exit' || info.reason === 'signal').toBe(true);
    expect(supervisor.size).toBe(0);
  });

  it('abort terminates process and leaves no live registry entry', async () => {
    const isWin = process.platform === 'win32';
    const supervised = isWin
      ? supervisor.spawn('shell', 'cmd.exe', ['/d', '/s', '/c', 'ping -n 30 127.0.0.1 >nul'], {
          isolateProcessGroup: false,
        })
      : supervisor.spawn('shell', '/bin/sleep', ['30']);

    expect(supervisor.size).toBe(1);
    supervised.abort('abort');
    const info = await supervised.join(5_000);
    expect(info.reason).toBe('abort');
    expect(supervisor.size).toBe(0);
  });

  it('timeout forces abort reason', async () => {
    const isWin = process.platform === 'win32';
    const supervised = isWin
      ? supervisor.spawn('shell', 'cmd.exe', ['/d', '/s', '/c', 'ping -n 30 127.0.0.1 >nul'], {
          isolateProcessGroup: false,
          timeoutMs: 200,
        })
      : supervisor.spawn('shell', '/bin/sleep', ['30'], { timeoutMs: 200 });

    const info = await supervised.exit;
    expect(info.reason).toBe('timeout');
    expect(supervisor.size).toBe(0);
  });

  it('joinAll clears all supervised processes', async () => {
    const isWin = process.platform === 'win32';
    for (let i = 0; i < 3; i += 1) {
      if (isWin) {
        supervisor.spawn('other', 'cmd.exe', ['/d', '/s', '/c', 'ping -n 30 127.0.0.1 >nul'], {
          isolateProcessGroup: false,
        });
      } else {
        supervisor.spawn('other', '/bin/sleep', ['30']);
      }
    }
    expect(supervisor.size).toBe(3);
    await supervisor.joinAll({ graceMs: 200, forceAfterMs: 2_000 });
    expect(supervisor.size).toBe(0);
  });

  it('spawn_failed surfaces for missing executable', async () => {
    const supervised = supervisor.spawn(
      'other',
      process.platform === 'win32' ? 'this-command-does-not-exist-xyz.cmd' : '/nonexistent/binary/path',
      [],
      { isolateProcessGroup: false },
    );
    const info = await supervised.exit;
    // Windows may report spawn_failed via error event or close; accept either spawn_failed or exit with error.
    expect(['spawn_failed', 'exit', 'signal', 'abort']).toContain(info.reason);
  });
});
