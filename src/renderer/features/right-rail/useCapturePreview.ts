import { useCallback, useEffect, useState } from 'react';
import { readLivePreview, type CaptureScope } from './capturePanelActions';

function toPngBytes(value: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(value.byteLength);
  copy.set(value);
  return copy;
}

export function useCapturePreview(
  scope: CaptureScope,
  source: { imagePath?: string | null; imageRevision?: number },
) {
  const [result, setResult] = useState<{ key: string; url: string | null; error: boolean } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt(value => value + 1), []);
  const imagePath = source.imagePath ?? null;
  const projectId = scope.projectId;
  const sessionId = scope.sessionId;
  const key = JSON.stringify([projectId, sessionId, imagePath, source.imageRevision, attempt]);
  const hasSource = Boolean(imagePath);
  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;
    const requestScope = { projectId, sessionId };
    const load = async () => {
      const bytes = imagePath ? await readLivePreview(requestScope) : null;
      if (!active) return;
      if (!bytes) { setResult({ key, url: null, error: hasSource }); return; }
      objectUrl = URL.createObjectURL(new Blob([toPngBytes(bytes)], { type: 'image/png' }));
      if (active) setResult({ key, url: objectUrl, error: false });
      else URL.revokeObjectURL(objectUrl);
    };
    void load().catch(() => { if (active) setResult({ key, url: null, error: true }); });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [projectId, sessionId, imagePath, key, hasSource]);
  return { url: result?.key === key ? result.url : null,
    loading: hasSource && result?.key !== key, error: result?.key === key && result.error, retry };
}
