import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { RdcCliInvokerSettings } from '@shared/types/settings';
const execute = vi.hoisted(() => vi.fn());
vi.mock('./RdcCliInvokerService', () => ({ rdcCliInvokerService: { executeCLI: execute } }));
import { withRdcRemoteProgress } from './RdcRemoteProgress';
const cli = { command: 'rdc', enabled: true, argsPrefix: [] } as unknown as RdcCliInvokerSettings;
const envelope = (kind: string, data: unknown) => ({ exitCode: 0, stdout: JSON.stringify({ ok: true, result_kind: kind, data }) });
const status = (patch: Record<string, unknown> = {}, contextId = 'context') => envelope('rdc_tool.daemon.status', { state: {
  context_id: contextId, active_operation: { operation: 'rd.remote.connect', trace_id: 'trace', started_at_ms: 1000, stage: 'installing', ...patch },
} });
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(1000); execute.mockReset(); });
afterEach(() => { vi.useRealTimers(); });
it.each(['checking', 'installing', 'starting', 'verifying'])('forwards only actual %s progress and stops polling after completion', async stage => {
  execute.mockResolvedValue(status({ stage })); const onPreparationStage = vi.fn(); let release!: () => void;
  const running = withRdcRemoteProgress('context', cli, undefined, { onPreparationStage }, () => new Promise<void>(resolve => { release = resolve; }));
  await vi.advanceTimersByTimeAsync(0); expect(onPreparationStage).toHaveBeenCalledWith(stage);
  release(); await running; const count = execute.mock.calls.length;
  await vi.advanceTimersByTimeAsync(1000); expect(execute).toHaveBeenCalledTimes(count); expect(vi.getTimerCount()).toBe(0);
});
it.each([
  ['foreign context', status({}, 'foreign')], ['older operation', status({ started_at_ms: 999 })],
  ['queued empty trace', status({ trace_id: '', stage: 'starting' })], ['blank trace', status({ trace_id: '  ' })],
  ['other operation', status({ operation: 'rd.capture.open_file' })], ['unknown phase', status({ stage: 'bootstrap_start' })],
])('ignores %s rather than inventing a preparation phase', async (_name, value) => {
  execute.mockResolvedValue(value); const onPreparationStage = vi.fn(); let release!: () => void;
  const running = withRdcRemoteProgress('context', cli, undefined, { onPreparationStage }, () => new Promise<void>(resolve => { release = resolve; }));
  await vi.advanceTimersByTimeAsync(0); release(); await running; expect(onPreparationStage).not.toHaveBeenCalled();
});
it('waits for a real trace after the daemon queue placeholder, then stops and joins on cancellation', async () => {
  execute.mockResolvedValueOnce(status({ trace_id: '', stage: 'starting' })).mockResolvedValue(status({ trace_id: 'actual-connect', stage: 'installing' }));
  const controller = new AbortController(); const onPreparationStage = vi.fn(); let finish!: () => void;
  const running = withRdcRemoteProgress('context', cli, controller.signal, { onPreparationStage }, () => new Promise<void>(resolve => { finish = resolve; }));
  await vi.advanceTimersByTimeAsync(0); expect(onPreparationStage).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(250); expect(onPreparationStage).toHaveBeenCalledExactlyOnceWith('installing');
  controller.abort(); finish(); await running;
  const count = execute.mock.calls.length; await vi.advanceTimersByTimeAsync(1000);
  expect(execute).toHaveBeenCalledTimes(count); expect(vi.getTimerCount()).toBe(0);
});
it('never overlaps status calls and ignores a late response after cancellation', async () => {
  let reply!: (value: unknown) => void; execute.mockImplementationOnce(() => new Promise(resolve => { reply = resolve; }));
  const controller = new AbortController(); const onPreparationStage = vi.fn(); let finish!: () => void;
  const running = withRdcRemoteProgress('context', cli, controller.signal, { onPreparationStage }, () => new Promise<void>(resolve => { finish = resolve; }));
  await vi.advanceTimersByTimeAsync(1000); expect(execute).toHaveBeenCalledOnce();
  controller.abort(); finish(); reply(status()); await running;
  expect(onPreparationStage).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
});
it('reads the joined cancelled operation installation receipt before returning to teardown', async () => {
  const controller = new AbortController(); const onInstallation = vi.fn(); const onPreparationStage = vi.fn();
  execute.mockResolvedValueOnce(status()).mockResolvedValueOnce(envelope('rd.core.get_operation_history', { context_id: 'context', operations: [
    { operation: 'rd.remote.connect', trace_id: 'old', started_at_ms: 999, stages: [{ stage: 'cancelled', details: { installation: { installed_apk: true, uninstalled_existing: true, install_mode: 'force_replace' } } }] },
    { operation: 'rd.remote.connect', trace_id: 'trace', started_at_ms: 1000, stages: [{ stage: 'cancelled', details: { installation: { installed_apk: true, uninstalled_existing: false, install_mode: 'update' } } }] },
  ] }));
  let cancel!: () => void;
  const running = withRdcRemoteProgress('context', cli, controller.signal, { onPreparationStage, onInstallation }, () => new Promise<void>((_resolve, reject) => {
    cancel = () => { controller.abort(); reject(new Error('cancelled')); };
  }));
  const settled = expect(running).rejects.toThrow('cancelled'); await vi.advanceTimersByTimeAsync(0); cancel(); await settled;
  expect(onInstallation).toHaveBeenCalledExactlyOnceWith({ installedApk: true, uninstalledExisting: false, installMode: 'update' });
  expect(execute.mock.calls[1]).toEqual(['call', ['rd.core.get_operation_history', '--args-json', JSON.stringify({ operation: 'rd.remote.connect', since_ms: 1000, max_items: 8 }), '--daemon-context', 'context'], expect.objectContaining({ contextId: 'context', settings: cli })]);
  expect(vi.getTimerCount()).toBe(0);
});
it('does not claim rollback or installation when history is unavailable', async () => {
  const controller = new AbortController(); const onInstallation = vi.fn(); execute.mockRejectedValue(new Error('unavailable'));
  await withRdcRemoteProgress('context', cli, controller.signal, { onInstallation }, async () => { controller.abort(); });
  expect(onInstallation).not.toHaveBeenCalled();
});
it('preserves an unconfirmed device mutation from the joined cancelled operation history', async () => {
  const controller = new AbortController(); const onDeviceAction = vi.fn(); const onInstallation = vi.fn();
  execute.mockResolvedValue(envelope('rd.core.get_operation_history', { context_id: 'context', operations: [
    { operation: 'rd.remote.connect', trace_id: 'trace', started_at_ms: 1000, stages: [{ stage: 'cancelled', message: 'Installation outcome is not confirmed', details: {
      device_action: { kind: 'android_install', state: 'unconfirmed', device_serial: 'PHONE', package_name: 'helper', apk_sha256: 'a'.repeat(64) },
      installation: { installed_apk: false, uninstalled_existing: true, install_mode: '' },
    } }] },
  ] }));
  await withRdcRemoteProgress('context', cli, controller.signal, { onDeviceAction, onInstallation }, async () => { controller.abort(); });
  expect(onDeviceAction).toHaveBeenCalledExactlyOnceWith({ code: 'remote_install_unconfirmed', stage: 'installing',
    diagnostic: 'Installation outcome is not confirmed', recovery: 'verify_installation',
    deviceAction: { kind: 'package_install', outcome: 'unconfirmed', uninstalledExisting: true } },
  { deviceSerial: 'PHONE', packageName: 'helper', apkSha256: 'a'.repeat(64) });
  expect(onInstallation).not.toHaveBeenCalled();
});
