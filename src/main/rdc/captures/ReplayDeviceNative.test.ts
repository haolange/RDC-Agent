import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReplayDeviceEntry } from '@shared/types/device';
const execute = vi.hoisted(() => vi.fn());
vi.mock('../../settings/settings-core/SettingsService', () => ({ settingsService: {} }));
vi.mock('../RdcCliInvokerService', () => ({ rdcCliInvokerService: { executeCLI: execute } }));
import { freezeRdcTurnBinding } from '../RdcTurnBindings';
import { connectSessionReplayDevice, inspectSessionReplayInstallation } from '../RdcRemoteConnection';
import { replayDeviceIssue } from './ReplayDeviceIssue';
import { RdcNativeFailure } from '../RdcNativeProtocol';
const cli = { enabled: true, command: 'rdc', argsPrefix: [], workingDirectory: '', env: {}, timeoutMs: 30000 };
const binding = freezeRdcTurnBinding(cli, [{ name: 'rd.remote.connect', preparation_policy: 'automatic', timeout_policy: { argument: 'timeout_ms', default_timeout_ms: 200000, worker_grace_ms: 85000, transport_grace_ms: 5000, process_grace_ms: 5000 }, input_schema: { properties: { timeout_ms: { type: 'integer' }, options: { properties: {
  transport: { enum: ['adb_android'] },
} } } } }, { name: 'rd.remote.inspect_installation', scope: 'global', effects: [], input_schema: { properties: { device_serial: { type: 'string' } } } }]);
const device: ReplayDeviceEntry = { id: 'selected', label: 'Phone', type: 'android', status: 'online', adbState: 'device', transport: 'adb_android', serial: 'SERIAL-SELECTED' };
const reply = (data: object, kind = 'rd.remote.connect') => ({ exitCode: 0, stdout: JSON.stringify({ ok: true, result_kind: kind, data }), stderr: '', duration_ms: 1 });
beforeEach(() => execute.mockReset());

it('preserves empty ADB output and exit zero as diagnostics instead of implying the device is offline', () => {
  const issue = replayDeviceIssue(new RdcNativeFailure('Invalid device state', 'rd.remote.connect', false, false, {
    code: 'adb_device_invalid_response', category: 'runtime', exitCode: 1,
    details: { command: ['adb', '-s', device.serial, 'get-state'], returncode: 0, stdout: '', stderr: '' },
  }));
  expect(issue.code).toBe('adb_device_invalid_response');
  expect(issue.diagnostic).toContain('get-state');
  expect(issue.diagnostic).toContain('"returncode": 0');
  expect(issue.diagnostic).toContain('"stdout": ""');
});
describe('session-owned remote connection', () => {
  it.each(['clear', 'pending', 'unknown'])('verifies installation through the one read-only canonical operation (%s)', async state => {
    execute.mockResolvedValue(reply({ context_id: 'owned', device_serial: device.serial, package_name: 'helper', apk_sha256: 'a'.repeat(64),
      installation_state: state, observation: ({ clear: 'verified', pending: 'pending', unknown: 'unreadable' } as Record<string, string>)[state], sessions: [] }, 'rd.remote.inspect_installation'));
    expect(await inspectSessionReplayInstallation(device, 'owned', binding)).toMatchObject({ state, deviceSerial: device.serial, packageName: 'helper', apkSha256: 'a'.repeat(64) });
    expect(execute).toHaveBeenCalledExactlyOnceWith('call', ['rd.remote.inspect_installation', '--args-json', JSON.stringify({ device_serial: device.serial }), '--daemon-context', 'owned'], expect.objectContaining({ contextId: 'owned', settings: cli }));
  });
  it('rejects uncorrelated or contradictory read-only inspection facts', async () => {
    execute.mockResolvedValue(reply({ context_id: 'owned', device_serial: 'OTHER', package_name: 'helper', apk_sha256: 'a'.repeat(64), installation_state: 'clear', observation: 'pending' }, 'rd.remote.inspect_installation'));
    await expect(inspectSessionReplayInstallation(device, 'owned', binding)).rejects.toThrow('INSTALLATION_PROTOCOL');
  });
  it('uses selected serial, owning context, safe repair policy and frozen CLI without global handoff', async () => {
    execute.mockResolvedValue(reply({ context_id: 'owned', remote_id: 'remote', server_info: { bootstrap: { package_name: 'helper', started_activity: false } } }));
    const result = await connectSessionReplayDevice(device, 'owned', binding);
    expect(result).toMatchObject({ contextId: 'owned', remoteId: 'remote', serial: device.serial, bootstrap: { packageName: 'helper', startedActivity: false } });
    const [command, argv, options] = execute.mock.calls[0];
    expect(command).toBe('call'); expect(argv[0]).toBe('rd.remote.connect');
    expect(JSON.parse(argv[2])).toEqual({ timeout_ms: 30000, options: { transport: 'adb_android', device_serial: 'SERIAL-SELECTED' } });
    expect(argv.slice(-2)).toEqual(['--daemon-context', 'owned']); expect(options.settings).toEqual(cli);
    expect(options.timeout).toBe(125000);
  });
  it.each([
    [{ context_id: 'foreign', remote_id: 'remote' }, 'rd.remote.connect'],
    [{ context_id: 'owned' }, 'rd.remote.connect'],
    [{ context_id: 'owned', remote_id: 'remote' }, 'rd.capture.open_replay'],
  ])('rejects invalid native identity %j', async (data, kind) => {
    execute.mockResolvedValue(reply(data, kind)); await expect(connectSessionReplayDevice(device, 'owned', binding)).rejects.toThrow();
  });
  it('does not publish a connect completed after cancellation', async () => {
    const controller = new AbortController(); execute.mockImplementation(async () => { controller.abort(); return reply({ context_id: 'owned', remote_id: 'remote' }); });
    await expect(connectSessionReplayDevice(device, 'owned', binding, controller.signal)).rejects.toThrow();
  });
  it('rejects an old loose options schema before invoking native code', async () => {
    await expect(connectSessionReplayDevice(device, 'owned', freezeRdcTurnBinding(cli, []))).rejects.toThrow('RDC_REMOTE_UPGRADE_REQUIRED');
    expect(execute).not.toHaveBeenCalled();
  });
  it('connects automatically without a repair policy or renderer-specified mutation', async () => {
    execute.mockResolvedValue(reply({ context_id: 'owned', remote_id: 'remote' }));
    await connectSessionReplayDevice(device, 'owned', binding);
    expect(JSON.parse(execute.mock.calls[0][1][2]).options).toEqual({ transport: 'adb_android', device_serial: device.serial });
  });
  it('derives process grace from the frozen catalog without changing the configured operation budget', async () => {
    execute.mockResolvedValue(reply({ context_id: 'owned', remote_id: 'remote' }));
    const definition = { ...binding.definitions[0], timeout_policy: { argument: 'timeout_ms', default_timeout_ms: 200000,
      worker_grace_ms: 4000, transport_grace_ms: 2000, process_grace_ms: 1000 } };
    const configured = { ...cli, timeoutMs: 120000 };
    await connectSessionReplayDevice(device, 'owned', freezeRdcTurnBinding(configured, [definition, binding.definitions[1]]));
    expect(JSON.parse(execute.mock.calls[0][1][2]).timeout_ms).toBe(120000);
    expect(execute.mock.calls[0][2]).toMatchObject({ timeout: 127000, settings: { timeoutMs: 120000 } });
  });
  it.each([undefined, { argument: 'timeout_ms', worker_grace_ms: 0 }])('rejects an absent or incomplete timeout policy before native execution', async timeout_policy => {
    await expect(connectSessionReplayDevice(device, 'owned', freezeRdcTurnBinding(cli, [{ ...binding.definitions[0], timeout_policy }]))).rejects.toThrow('UPGRADE_REQUIRED');
    expect(execute).not.toHaveBeenCalled();
  });
});
