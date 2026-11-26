import { beforeEach, describe, expect, it, vi } from 'vitest';
import { freezeRdcTurnBinding } from '../RdcTurnBindings';
import { connectSessionReplayDevice, inspectSessionReplayInstallation } from '../RdcRemoteConnection';
import { RdcNativeFailure } from '../RdcNativeProtocol';
import { replayDeviceIssue } from './ReplayDeviceIssue';
import type { ReplayDeviceEntry } from '@shared/types/device';

const execute = vi.hoisted(() => vi.fn());
vi.mock('../../settings/settings-core/SettingsService', () => ({ settingsService: {} }));
vi.mock('../RdcCliInvokerService', () => ({ rdcCliInvokerService: { executeCLI: execute } }));
const cli = {
  enabled: true,
  command: 'rdc',
  argsPrefix: [],
  workingDirectory: '',
  env: {},
  noProgressTimeoutMs: 30_000,
};
const binding = freezeRdcTurnBinding(cli, [
  {
    name: 'rd.remote.connect',
    preparation_policy: 'automatic',
    input_schema: {
      properties: {
        options: {
          properties: {
            transport: { enum: ['adb_android'] },
          },
        },
      },
    },
  },
  {
    name: 'rd.remote.inspect_installation',
    scope: 'global',
    effects: [],
    input_schema: { properties: { device_serial: { type: 'string' } } },
  },
]);
const device: ReplayDeviceEntry = {
  id: 'selected',
  label: 'Phone',
  type: 'android',
  status: 'online',
  adbState: 'device',
  transport: 'adb_android',
  serial: 'SERIAL-SELECTED',
};
const reply = (data: object, kind = 'rd.remote.connect') => ({
  exitCode: 0,
  stdout: JSON.stringify({ ok: true, result_kind: kind, data }),
  stderr: '',
  duration_ms: 1,
});
beforeEach(() => execute.mockReset());

it('preserves empty ADB output and exit zero as diagnostics instead of implying the device is offline', () => {
  const issue = replayDeviceIssue(
    new RdcNativeFailure('Invalid device state', 'rd.remote.connect', false, {
      code: 'adb_device_invalid_response',
      category: 'runtime',
      exitCode: 1,
      details: { command: ['adb', '-s', device.serial, 'get-state'], returncode: 0, stdout: '', stderr: '' },
    }),
  );
  expect(issue.code).toBe('adb_device_invalid_response');
  expect(issue.diagnostic).toContain('get-state');
  expect(issue.diagnostic).toContain('"returncode": 0');
  expect(issue.diagnostic).toContain('"stdout": ""');
});
describe('session-owned remote connection', () => {
  it.each(['clear', 'pending', 'unknown'])(
    'verifies installation through the one read-only canonical operation (%s)',
    async (state) => {
      execute.mockResolvedValue(
        reply(
          {
            context_id: 'owned',
            device_serial: device.serial,
            package_name: 'helper',
            apk_sha256: 'a'.repeat(64),
            installation_state: state,
            observation: ({ clear: 'verified', pending: 'pending', unknown: 'unreadable' } as Record<string, string>)[
              state
            ],
            sessions: [],
          },
          'rd.remote.inspect_installation',
        ),
      );
      expect(await inspectSessionReplayInstallation(device, 'owned', binding)).toMatchObject({
        state,
        deviceSerial: device.serial,
        packageName: 'helper',
        apkSha256: 'a'.repeat(64),
      });
      expect(execute).toHaveBeenCalledExactlyOnceWith(
        'call',
        [
          'rd.remote.inspect_installation',
          '--args-json',
          JSON.stringify({ device_serial: device.serial }),
          '--daemon-context',
          'owned',
        ],
        expect.objectContaining({ contextId: 'owned', settings: cli }),
      );
    },
  );
  it('rejects uncorrelated or contradictory read-only inspection facts', async () => {
    execute.mockResolvedValue(
      reply(
        {
          context_id: 'owned',
          device_serial: 'OTHER',
          package_name: 'helper',
          apk_sha256: 'a'.repeat(64),
          installation_state: 'clear',
          observation: 'pending',
        },
        'rd.remote.inspect_installation',
      ),
    );
    await expect(inspectSessionReplayInstallation(device, 'owned', binding)).rejects.toThrow('INSTALLATION_PROTOCOL');
  });
  it('uses selected serial, owning context, safe repair policy and frozen CLI without global handoff', async () => {
    execute.mockResolvedValue(
      reply({
        context_id: 'owned',
        remote_id: 'remote',
        server_info: { bootstrap: { package_name: 'helper', started_activity: false } },
      }),
    );
    const result = await connectSessionReplayDevice(device, 'owned', binding);
    expect(result).toMatchObject({
      contextId: 'owned',
      remoteId: 'remote',
      serial: device.serial,
      bootstrap: { packageName: 'helper', startedActivity: false },
    });
    const [command, argv, options] = execute.mock.calls[0];
    expect(command).toBe('call');
    expect(argv[0]).toBe('rd.remote.connect');
    expect(JSON.parse(argv[2])).toEqual({
      options: { transport: 'adb_android', device_serial: 'SERIAL-SELECTED' },
    });
    expect(argv.slice(-2)).toEqual(['--daemon-context', 'owned']);
    expect(options).toEqual({ contextId: 'owned', abortSignal: undefined, settings: cli });
  });
  it.each([
    [{ context_id: 'foreign', remote_id: 'remote' }, 'rd.remote.connect'],
    [{ context_id: 'owned' }, 'rd.remote.connect'],
    [{ context_id: 'owned', remote_id: 'remote' }, 'rd.capture.open_replay'],
  ])('rejects invalid native identity %j', async (data, kind) => {
    execute.mockResolvedValue(reply(data, kind));
    await expect(connectSessionReplayDevice(device, 'owned', binding)).rejects.toThrow();
  });
  it('does not publish a connect completed after cancellation', async () => {
    const controller = new AbortController();
    execute.mockImplementation(async () => {
      controller.abort();
      return reply({ context_id: 'owned', remote_id: 'remote' });
    });
    await expect(connectSessionReplayDevice(device, 'owned', binding, controller.signal)).rejects.toThrow();
  });
  it('rejects an old loose options schema before invoking native code', async () => {
    await expect(connectSessionReplayDevice(device, 'owned', freezeRdcTurnBinding(cli, []))).rejects.toThrow(
      'RDC_REMOTE_UPGRADE_REQUIRED',
    );
    expect(execute).not.toHaveBeenCalled();
  });
  it('connects automatically without a repair policy or renderer-specified mutation', async () => {
    execute.mockResolvedValue(reply({ context_id: 'owned', remote_id: 'remote' }));
    await connectSessionReplayDevice(device, 'owned', binding);
    expect(JSON.parse(execute.mock.calls[0][1][2]).options).toEqual({
      transport: 'adb_android',
      device_serial: device.serial,
    });
  });
});
