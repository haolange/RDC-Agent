import { beforeEach, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
const mocks = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock('../tools/RdxCliInvokerService', () => ({ rdxCliInvokerService: { executeCLI: mocks.execute } }));
vi.mock('../settings/SettingsService', () => ({ settingsService: { getAll: () => ({ tooling: { rdxCli: { argsPrefix: [], enabled: true, command: 'rdx' } } }) } }));
vi.mock('electron', () => ({ nativeImage: { createFromPath: () => ({ isEmpty: () => false, getSize: () => ({ width: 100, height: 100 }), toDataURL: () => 'data:image/png;base64,eA==' }) } }));
import { observeReplay, readReplayEvents } from './RdxReplayObservation';
const owner = { contextId: 'context', replaySessionId: 'replay', runtimeOwner: 'app', ownerLeaseId: 'lease', backend: 'local' as const, updatedAt: 0 };
let exportedPath = '';
function reply(patch: Record<string, unknown> = {}) {
  mocks.execute.mockImplementation(async (_operation, argv) => {
    exportedPath = JSON.parse(argv[2]).out_path;
    return { exitCode: 0, stdout: JSON.stringify({ ok: true, result_kind: 'rd.session.observe', data: {
      context_id: 'context', session_id: 'replay', event_id: 9, image_event_id: 9, image_path: exportedPath,
      revision: 3, modification_state: 'baseline', display_parameters: { mip: 0, slice: 0, sample: 0, range_min: 0, range_max: 1 },
      target: { texture_id: 'ResourceId::1', output_slot: null }, targets: [], is_final_output: true,
      remote_display: { status: 'not_applicable' }, ...patch,
    } }) };
  });
}
beforeEach(() => { mocks.execute.mockReset(); reply(); });
it.each(['baseline', 'intervention', 'restored'])('projects native %s facts and actual display parameters', async modificationState => {
  reply({ modification_state: modificationState });
  const result = await observeReplay(owner, {});
  expect(result.observation).toEqual({ nativeRevision: 3, modificationState,
    displayParameters: { mip: 0, slice: 0, sample: 0, rangeMin: 0, rangeMax: 1 } });
});
it('rejects invented or missing observation metadata', async () => {
  reply({ modification_state: 'probably_restored' });
  await expect(observeReplay(owner, {})).rejects.toThrow('METADATA_INVALID');
});
it.each(['no_color_output', 'missing_target', 'export_failure'])('preserves %s and only retries image export failures', async code => {
  reply({ image_path: null, image_event_id: null, image_error: { code, message: code } });
  const result = await observeReplay(owner, {});
  expect(result.appliedEventId).toBe(9);
  expect(result.image).toBeNull();
  expect(result.imageEventId).toBeNull();
  expect(result.error).toEqual({ code, message: code, retry: code === 'export_failure' ? 'image' : null });
});
it('rejects malformed native image errors instead of inventing a no-output result', async () => {
  reply({ image_path: null, image_event_id: null, image_error: { code: 42, message: 'invalid' } });
  await expect(observeReplay(owner, {})).rejects.toThrow('IMAGE_ERROR_INVALID');
});
it('requires exact native replay identity and cleans failed observation temporary directory', async () => {
  reply({ session_id: 'foreign' });
  await expect(observeReplay(owner, {})).rejects.toThrow('IDENTITY_MISMATCH');
  await expect(fs.stat(path.dirname(exportedPath))).rejects.toHaveProperty('code', 'ENOENT');
});
it.each([null, undefined, 8, '9'])('does not relabel unknown or mismatched image EID %s', async (imageEventId) => {
  reply({ image_event_id: imageEventId }); await expect(observeReplay(owner, {})).rejects.toThrow('IMAGE_EVENT_MISMATCH');
});
it('preserves final-output warning while showing actual observed event', async () => {
  reply({ is_final_output: false, final_output_error: { code: 'final_output_unavailable', message: 'No final Present resource' } });
  const result = await observeReplay(owner, {});
  expect(result.imageEventId).toBe(9); expect(result.isFinalOutput).toBe(false); expect(result.warning?.code).toBe('final_output_unavailable');
  await expect(fs.stat(path.dirname(exportedPath))).rejects.toHaveProperty('code', 'ENOENT');
});

it('uses context-scoped observe argv without replay identity parameters', async () => {
  await observeReplay(owner, { event_id: 9 });
  const argv = mocks.execute.mock.calls[0][1];
  expect(JSON.parse(argv[2])).toEqual({ event_id: 9, out_path: exportedPath });
  expect(argv.slice(-2)).toEqual(['--daemon-context', 'context']);
});
it('requests the full context event index with no session parameter', async () => {
  mocks.execute.mockResolvedValue({ exitCode: 0, stdout: JSON.stringify({ ok: true, result_kind: 'rd.session.get_replay_events', data: { context_id: 'context', session_id: 'replay', complete: true, events: [{ event_id: 1, name: 'Draw' }] } }) });
  expect(await readReplayEvents(owner)).toEqual([{ eventId: 1, name: 'Draw' }]);
  expect(JSON.parse(mocks.execute.mock.calls[0][1][2])).toEqual({});
});
