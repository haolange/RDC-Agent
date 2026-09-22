// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { useCapturePreviewUrl } from './useCapturePreviewUrl';
import { readLivePreview } from './capturePanelActions';

vi.mock('./capturePanelActions', () => ({ readLivePreview: vi.fn(), readReplayImage: vi.fn() }));

describe('capture preview URL ownership', () => {
  it('drops old session results and revokes only the rendered image when replaced or unmounted', async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const host = document.createElement('div'); const root = createRoot(host);
    let finishOld!: (bytes: Uint8Array) => void;
    vi.mocked(readLivePreview).mockReturnValueOnce(new Promise((resolve) => { finishOld = resolve; }))
      .mockResolvedValueOnce(new Uint8Array([1, 2]));
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:current');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    function Probe({ sessionId }: { sessionId: string }) {
      const url = useCapturePreviewUrl({ projectId: 'project', sessionId }, { imagePath: '/preview.png' });
      return createElement('span', null, url);
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
