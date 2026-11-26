import { spawn } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import {
  createProcessContract,
  currentProcessIdentity,
  isolatedChildSpawnOptions,
  probeProcess,
  terminateProcessTree,
} from './process';
import { currentHost } from './host';
import type { ProcessBackend } from './processBackend';

function fakeBackend(
  births: Record<number, string | Error | null>,
): ProcessBackend & { killTree: ReturnType<typeof vi.fn> } {
  const read = (pid: number): string | null => {
    const value = births[pid] ?? null;
    if (value instanceof Error) throw value;
    return value;
  };
  return {
    isRunning: (pid) => read(pid) !== null,
    readBirth: read,
    readCommandLine: () => null,
    killTree: vi.fn(() => true),
    signalChildTree: () => undefined,
    childGroupOptions: {},
  };
}

describe('process identity contract', () => {
  it('distinguishes alive, exited and unknown by (pid, birth)', () => {
    const contract = createProcessContract(fakeBackend({ 7: 'birth-a', 8: new Error('denied') }));
    expect(contract.probeProcess({ pid: 7, birth: 'birth-a' })).toBe('alive');
    expect(contract.probeProcess({ pid: 7, birth: 'birth-old' })).toBe('exited');
    expect(contract.probeProcess({ pid: 7, birth: '' })).toBe('alive');
    expect(contract.probeProcess({ pid: 9, birth: 'birth-a' })).toBe('exited');
    expect(contract.probeProcess({ pid: 8, birth: 'birth-a' })).toBe('unknown');
    expect(contract.probeProcess({ pid: 0, birth: '' })).toBe('exited');
  });

  it('answers for this process from its cached identity without querying the host again', () => {
    const backend = fakeBackend({ [process.pid]: 'birth-self' });
    const readBirth = vi.spyOn(backend, 'readBirth');
    const contract = createProcessContract(backend);
    expect(contract.probeProcess({ pid: process.pid, birth: 'birth-self' })).toBe('alive');
    expect(contract.probeProcess({ pid: process.pid, birth: 'birth-previous-owner' })).toBe('exited');
    expect(contract.probeProcess({ pid: process.pid, birth: '' })).toBe('alive');
    expect(readBirth).toHaveBeenCalledTimes(1);
    const unreadable = createProcessContract(fakeBackend({ [process.pid]: new Error('denied') }));
    expect(unreadable.currentProcessIdentity().birth).toBe('');
    expect(unreadable.probeProcess({ pid: process.pid, birth: 'birth-self' })).toBe('unknown');
  });

  it('kills only an identity that still probes alive', () => {
    const backend = fakeBackend({ 7: 'birth-a', 8: new Error('denied') });
    const contract = createProcessContract(backend);
    expect(contract.terminateProcessTree({ pid: 7, birth: 'birth-old' })).toBe('exited');
    expect(contract.terminateProcessTree({ pid: 8, birth: 'birth-a' })).toBe('unconfirmed');
    expect(backend.killTree).not.toHaveBeenCalled();
    expect(contract.terminateProcessTree({ pid: 7, birth: 'birth-a' })).toBe('terminated');
    expect(backend.killTree).toHaveBeenCalledExactlyOnceWith(7, 3000);
  });
});

describe('process identity on this host', () => {
  it.skipIf(currentHost().isMac)('identifies this process and rejects a recorded birth that does not match it', () => {
    const self = currentProcessIdentity();
    expect(self.pid).toBe(process.pid);
    expect(self.birth).toMatch(/^(windows-filetime:[1-9]\d*|linux-start-ticks:[a-f0-9-]{36}:[1-9]\d*)$/);
    expect(probeProcess(self)).toBe('alive');
    expect(probeProcess({ pid: self.pid, birth: `${self.birth}0` })).toBe('exited');
  });

  it('terminates an isolated child together with its descendants', { timeout: 20_000 }, async () => {
    const script =
      "const c=require('child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});" +
      "process.stdout.write(String(c.pid)+'\\n');setInterval(()=>{},1000);";
    const child = spawn(process.execPath, ['-e', script], {
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
      ...isolatedChildSpawnOptions(),
    });
    const grandchild = await new Promise<number>((resolve, reject) => {
      child.stdout.once('data', (chunk: Buffer) => resolve(Number(chunk.toString().trim())));
      child.once('error', reject);
    });
    const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
    expect(terminateProcessTree({ pid: child.pid!, birth: '' })).toBe('terminated');
    await exited;
    const deadline = Date.now() + 10_000;
    while (probeProcess({ pid: grandchild, birth: '' }) !== 'exited' && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(probeProcess({ pid: grandchild, birth: '' })).toBe('exited');
    expect(probeProcess({ pid: child.pid!, birth: '' })).toBe('exited');
  });
});
