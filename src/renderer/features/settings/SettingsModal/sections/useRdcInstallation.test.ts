import { beforeEach, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../../../../stores/defaultAppSettings';
import { useRdcInstallation } from './useRdcInstallation';

const mock = vi.hoisted(() => ({ values: [] as unknown[], cleanup: [] as (() => void)[],
  verify: vi.fn(), save: vi.fn(), select: vi.fn(), resolve: vi.fn(), detect: vi.fn() }));
vi.mock('react', () => ({
  useRef: (current: unknown) => ({ current }),
  useState: (initial: unknown) => {
    const index = mock.values.length;
    mock.values.push(initial);
    return [initial, (value: unknown) => { mock.values[index] = value; }];
  },
  useEffect: (effect: () => () => void) => { mock.cleanup.push(effect()); },
}));
vi.mock('../../../../platform/rdcInstallation', () => ({
  validateRdcInstallation: mock.verify, selectRdcInstallation: mock.select,
  resolveRdcInstallation: mock.resolve, detectRdcInstallations: mock.detect,
}));
vi.mock('../../../../stores/appSettingsStore', () => ({ useAppSettingsStore: { getState: () => ({ patchSettings: mock.save }) } }));
const draft = { ...DEFAULT_SETTINGS.tooling.rdcCli, workingDirectory: 'D:\\工具 folder' };
const verified = { settings: { ...draft, enabled: true }, summary: { cli: { available: true } } };
beforeEach(() => { vi.clearAllMocks(); mock.values = []; mock.cleanup = []; mock.verify.mockResolvedValue(verified); });

it('validates the selected draft before saving and reports success only after persistence', async () => {
  mock.save.mockResolvedValue({ tooling: { rdcCli: verified.settings } });
  const applied = vi.fn();
  await useRdcInstallation(draft, applied).apply();
  expect(mock.verify).toHaveBeenCalledWith({ root: draft.workingDirectory, timeoutMs: draft.timeoutMs, env: draft.env });
  expect(mock.verify.mock.invocationCallOrder[0]).toBeLessThan(mock.save.mock.invocationCallOrder[0]);
  expect(applied).toHaveBeenCalledWith(verified.settings);
  expect(mock.values[3]).toEqual(verified.summary);
});
it.each(['catalog mismatch', 'save failed'])('does not claim applied on %s', async (reason) => {
  if (reason === 'catalog mismatch') mock.verify.mockRejectedValue(new Error(reason));
  else mock.save.mockRejectedValue(new Error(reason));
  const applied = vi.fn();
  await useRdcInstallation(draft, applied).apply();
  expect(applied).not.toHaveBeenCalled();
  expect(mock.values[3]).toBeNull();
  expect(mock.values[4]).toBe(reason);
  if (reason === 'catalog mismatch') expect(mock.save).not.toHaveBeenCalled();
});
it.each(['close', 'replace'])('discards verification after %s before any save', async (action) => {
  let finish!: (value: typeof verified) => void;
  mock.verify.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  const applied = vi.fn();
  const state = useRdcInstallation(draft, applied);
  const pending = state.apply();
  if (action === 'close') mock.cleanup.forEach((cleanup) => cleanup());
  else state.invalidate();
  finish(verified);
  await pending;
  expect(mock.save).not.toHaveBeenCalled();
  expect(applied).not.toHaveBeenCalled();
});
it('cancelled folder selection retains the binding without resolution or persistence', async () => {
  mock.select.mockResolvedValue(null);
  await useRdcInstallation(draft, vi.fn()).select();
  expect(mock.values[0]).toBe(draft.workingDirectory);
  expect(mock.resolve).not.toHaveBeenCalled();
  expect(mock.save).not.toHaveBeenCalled();
});
