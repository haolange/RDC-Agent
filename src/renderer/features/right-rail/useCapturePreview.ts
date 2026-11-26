import { useCallback, useState } from 'react';
import { useAsyncValue } from '../../lib/useAsyncValue';
import { readLivePreview, type CaptureScope } from './capturePanelActions';

function toPngBytes(value: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(value.byteLength);
  copy.set(value);
  return copy;
}

const revoke = (url: string | null) => {
  if (url) URL.revokeObjectURL(url);
};

export function useCapturePreview(scope: CaptureScope, source: { imagePath?: string | null; imageRevision?: number }) {
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  const imagePath = source.imagePath ?? null;
  const { projectId, sessionId } = scope;
  const hasSource = Boolean(imagePath);
  // An object URL lives while it shows: one replaced, unmounted or answered too late is revoked.
  const preview = useAsyncValue(
    JSON.stringify([projectId, sessionId, imagePath, source.imageRevision, attempt]),
    async (signal) => {
      const bytes = imagePath ? await readLivePreview({ projectId, sessionId }) : null;
      // A superseded read makes no URL at all.
      signal.throwIfAborted();
      return bytes ? URL.createObjectURL(new Blob([toPngBytes(bytes)], { type: 'image/png' })) : null;
    },
    { dispose: revoke },
  );
  const url = preview.status === 'ready' ? preview.value : null;
  return {
    url,
    loading: hasSource && preview.status === 'loading',
    error: preview.status === 'error' || (preview.status === 'ready' && !url && hasSource),
    retry,
  };
}
