// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { useCapturePreview } from './useCapturePreview';
import { readLivePreview } from './capturePanelActions';

vi.mock('./capturePanelActions', () => ({ readLivePreview: vi.fn() }));

describe('capture preview URL ownership', () => {
  it('reloads same-EID replacements, clears obsolete pixels immediately and retries reads without native mutation', async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const host = document.createElement('div'); const root = createRoot(host);
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValueOnce('blob:first').mockReturnValueOnce('blob:second');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    vi.mocked(readLivePreview).mockReset().mockResolvedValueOnce(new Uint8Array([1])).mockRejectedValueOnce(new Error('read failed')).mockResolvedValueOnce(new Uint8Array([2]));
    const renders: Array<string | null> = [];
    function Probe({ revision }: { revision: number }) {
      const preview = useCapturePreview({ projectId: 'project', sessionId: 'session' }, { imagePath: 'live:1:42', imageRevision: revision });
      renders.push(preview.url);
      return createElement('button', { onClick: preview.retry }, preview.url ?? (preview.error ? 'error' : 'loading'));
    }
    try {
      await act(async () => root.render(createElement(Probe, { revision: 1 })));
      expect(host.textContent).toBe('blob:first'); renders.length = 0;
      await act(async () => root.render(createElement(Probe, { revision: 2 })));
      expect(renders[0]).toBeNull(); expect(host.textContent).toBe('error');
      expect(revoke).toHaveBeenCalledWith('blob:first');
      await act(async () => host.querySelector('button')!.click());
      expect(host.textContent).toBe('blob:second');
      expect(readLivePreview).toHaveBeenCalledTimes(3);
    } finally { act(() => root.unmount()); create.mockRestore(); revoke.mockRestore(); }
  });
  it('drops a late same-capture image when a newer replay revision arrives', async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const host = document.createElement('div'); const root = createRoot(host);
    let finish!: (bytes: Uint8Array) => void;
    vi.mocked(readLivePreview).mockReset().mockReturnValueOnce(new Promise(resolve => { finish = resolve; })).mockResolvedValueOnce(new Uint8Array([1]));
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:live');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    function Probe({ saved }: { saved: boolean }) {
      const preview = useCapturePreview({ projectId: 'project', sessionId: 'session' }, { imagePath: 'live:1:42', imageRevision: saved ? 1 : 2 });
      return createElement('span', null, preview.url);
    }
    try {
      await act(async () => root.render(createElement(Probe, { saved: true })));
      await act(async () => root.render(createElement(Probe, { saved: false })));
      await act(async () => finish(new Uint8Array([2])));
      expect(host.textContent).toBe('blob:live'); expect(create).toHaveBeenCalledOnce();
    } finally { act(() => root.unmount()); create.mockRestore(); revoke.mockRestore(); }
  });
  it('drops old session results and revokes only the rendered image when replaced or unmounted', async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const host = document.createElement('div'); const root = createRoot(host);
    let finishOld!: (bytes: Uint8Array) => void;
    vi.mocked(readLivePreview).mockReturnValueOnce(new Promise((resolve) => { finishOld = resolve; }))
      .mockResolvedValueOnce(new Uint8Array([1, 2]));
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:current');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    function Probe({ sessionId }: { sessionId: string }) {
      const preview = useCapturePreview({ projectId: 'project', sessionId }, { imagePath: '/preview.png' });
      return createElement('span', null, preview.url);
    }
    try {
      await act(async () => root.render(createElement(Probe, { sessionId: 'old' })));
      await act(async () => root.render(createElement(Probe, { sessionId: 'current' })));
      expect(host.textContent).toBe('blob:current');
      await act(async () => finishOld(new Uint8Array([3, 4])));
      expect(create).toHaveBeenCalledOnce();
      expect(revoke).not.toHaveBeenCalled();
      act(() => root.unmount());
      expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:current');
    } finally { create.mockRestore(); revoke.mockRestore(); }
  });
});
