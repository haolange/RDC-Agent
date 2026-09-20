import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReplayDeviceEntry } from '@shared/types/device';
const execute = vi.hoisted(() => vi.fn());
vi.mock('electron', () => ({ BrowserWindow: class {} }));
vi.mock('../tools/RdcCliInvokerService', () => ({ rdcCliInvokerService: { executeCLI: execute } }));
vi.mock('../sessions/StorageAdapter', () => ({ storageAdapter: {} }));
vi.mock('../runtime/RuntimeLogService', () => ({ runtimeLogService: { log: vi.fn() } }));
vi.mock('../browserAppBridge/rendererEventHub', () => ({ rendererEventHub: { emit: vi.fn() } }));
import { ReplayDeviceService } from './ReplayDeviceService';
const cli = { enabled: true, command: 'rdc', argsPrefix: [], workingDirectory: '', env: {}, timeoutMs: 30000 };
const device: ReplayDeviceEntry = { id: 'selected', label: 'Phone', type: 'android', status: 'offline', transport: 'adb_android', serial: 'SERIAL-SELECTED' };
function service() {
  const value = new ReplayDeviceService();
  const internals = value as unknown as { devices: Map<string, ReplayDeviceEntry>; persistResumeCache: () => Promise<void>; broadcast: () => void };
  internals.devices.set(device.id, device); internals.persistResumeCache = vi.fn(async () => {}); internals.broadcast = vi.fn();
  return value;
}
const reply = (data: object, kind = 'rd.remote.connect') => ({ exitCode: 0, stdout: JSON.stringify({ ok: true, result_kind: kind, data }), stderr: '', duration_ms: 1 });
beforeEach(() => execute.mockReset());
describe('native remote activation', () => {
  it('uses selected serial, owning context and frozen CLI argv', async () => {
    execute.mockResolvedValue(reply({ context_id: 'owned', remote_id: 'remote' }));
    const value = service(); expect((await value.activateDevice('selected', { contextId: 'owned', cli })).status).toBe('online');
    const [command, argv, options] = execute.mock.calls[0];
    expect(command).toBe('call'); expect(argv[0]).toBe('rd.remote.connect');
    expect(JSON.parse(argv[2])).toEqual({ options: { transport: 'adb_android', device_serial: 'SERIAL-SELECTED' } });
    expect(argv.slice(-2)).toEqual(['--daemon-context', 'owned']); expect(options.settings).toBe(cli);
    expect(value.peekPreparedRemote('selected')).toMatchObject({ contextId: 'owned', remoteId: 'remote', serial: 'SERIAL-SELECTED' });
  });
  it.each([
    [{ context_id: 'foreign', remote_id: 'remote' }, 'rd.remote.connect'],
    [{ context_id: 'owned' }, 'rd.remote.connect'],
    [{ context_id: 'owned', remote_id: 'remote' }, 'rd.capture.open_replay'],
  ])('does not prepare invalid native identity %j', async (data, kind) => {
    execute.mockResolvedValue(reply(data, kind)); const value = service();
    expect((await value.activateDevice('selected', { contextId: 'owned', cli })).status).not.toBe('online');
    expect(value.peekPreparedRemote('selected')).toBeNull();
  });
  it('does not prepare a connect which completes after cancellation', async () => {
    const controller = new AbortController(); execute.mockImplementation(async () => { controller.abort(); return reply({ context_id: 'owned', remote_id: 'remote' }); });
    const value = service(); await value.activateDevice('selected', { contextId: 'owned', cli, signal: controller.signal });
    expect(value.peekPreparedRemote('selected')).toBeNull();
  });
});
