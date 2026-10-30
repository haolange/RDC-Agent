import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useRuntimePermissionStore as store } from './runtimePermissionStore';

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

describe('main-owned permission state', () => {
  beforeEach(() => store.setState({ snapshot: { mode: 'default', revision: 1 }, pendingMode: null, error: false }));
  afterEach(() => vi.unstubAllGlobals());

  it('keeps the confirmed mode while saving and accepts the committed snapshot', async () => {
    const save = deferred<unknown>();
    const getPermissionState = vi.fn().mockResolvedValue({ mode: 'full-access', revision: 2 });
    vi.stubGlobal('window', { electronAPI: { settings: { set: () => save.promise }, runtime: { getPermissionState } } });
    const result = store.getState().saveMode('full-access');
    expect(store.getState().snapshot?.mode).toBe('default');
    expect(store.getState().pendingMode).toBe('full-access');
    save.resolve({});
    await result;
    expect(store.getState().snapshot).toEqual({ mode: 'full-access', revision: 2 });
    expect(store.getState().pendingMode).toBeNull();
  });

  it('does not roll back a committed mode when the settings response is lost', async () => {
    vi.stubGlobal('window', { electronAPI: {
      settings: { set: vi.fn().mockRejectedValue(new Error('response lost')) },
      runtime: { getPermissionState: vi.fn().mockResolvedValue({ mode: 'full-access', revision: 2 }) },
    } });
    await expect(store.getState().saveMode('full-access')).resolves.toEqual({ mode: 'full-access', revision: 2 });
    expect(store.getState().error).toBe(false);
  });

  it('preserves the authoritative mode on a failed save', async () => {
    vi.stubGlobal('window', { electronAPI: {
      settings: { set: vi.fn().mockRejectedValue(new Error('disk full')) },
      runtime: { getPermissionState: vi.fn().mockResolvedValue({ mode: 'default', revision: 1 }) },
    } });
    await expect(store.getState().saveMode('full-access')).rejects.toThrow('disk full');
    expect(store.getState()).toMatchObject({ snapshot: { mode: 'default', revision: 1 }, pendingMode: null, error: true });
  });

  it('rejects old snapshots and never lets a late request clear a newer pending choice', async () => {
    const first = deferred<unknown>();
    const second = deferred<unknown>();
    const set = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const getPermissionState = vi.fn().mockResolvedValue({ mode: 'full-access', revision: 2 });
    vi.stubGlobal('window', { electronAPI: { settings: { set }, runtime: { getPermissionState } } });
    const a = store.getState().saveMode('full-access');
    const b = store.getState().saveMode('default');
    first.resolve({});
    await a;
    expect(store.getState().pendingMode).toBe('default');
    store.getState().applySnapshot({ mode: 'default', revision: 3 });
    second.resolve({});
    await b;
    expect(store.getState().snapshot).toEqual({ mode: 'default', revision: 3 });
    expect(store.getState().pendingMode).toBeNull();
  });

  it('marks an unavailable query without inventing an effective state', async () => {
    store.setState({ snapshot: null });
    vi.stubGlobal('window', { electronAPI: { runtime: { getPermissionState: vi.fn().mockRejectedValue(new Error('offline')) } } });
    await expect(store.getState().refresh()).rejects.toThrow('offline');
    expect(store.getState()).toMatchObject({ snapshot: null, error: true });
  });
});
