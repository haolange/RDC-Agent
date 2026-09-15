import { useEffect, useState } from 'react';
import { readLivePreview, readReplayImage, type CaptureScope } from './capturePanelActions';

function toPngBytes(value: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(value.byteLength);
  copy.set(value);
  return copy;
}

export function useCapturePreviewUrl(
  scope: CaptureScope,
  source: { imagePath?: string | null; captureHash?: string | null; imageHash?: string | null },
): string | null {
  const [url, setUrl] = useState<string | null>(null);
  const imagePath = source.imagePath ?? null;
  const captureHash = source.captureHash ?? null;
  const imageHash = source.imageHash ?? null;
  const projectId = scope.projectId;
  const sessionId = scope.sessionId;
  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;
    setUrl(null);
    const requestScope = { projectId, sessionId };
    const load = async () => {
      const bytes = imagePath
        ? await readLivePreview(requestScope)
        : captureHash && imageHash
          ? await readReplayImage({ ...requestScope, captureHash, imageHash })
          : null;
      if (!bytes || !active) return;
      objectUrl = URL.createObjectURL(new Blob([toPngBytes(bytes)], { type: 'image/png' }));
      if (active) setUrl(objectUrl);
      else URL.revokeObjectURL(objectUrl);
    };
    void load().catch(() => { if (active) setUrl(null); });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [projectId, sessionId, imagePath, captureHash, imageHash]);
  return url;
}
