import { assertPublicHttpUrl, fetchPinnedPublic, type PinnedPublicHttpUrl } from '../agent-runtime/net/assertPublicHttpUrl';
import { readLimitedBytes, sniffRasterImageMime, toDataUrl } from './mediaBytes';

export const REMOTE_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 3;

export type RemoteImageResult = { dataUrl: string } | { dataUrl: null; error: RemoteImageError };
export type RemoteImageError = 'REMOTE_IMAGE_URL_DENIED' | 'REMOTE_IMAGE_UNAVAILABLE' | 'REMOTE_IMAGE_TOO_LARGE' | 'REMOTE_IMAGE_TYPE_DENIED';

/** Every hop must stay on https and on a public address; the renderer's CSP never widens for remote images. */
async function pinHttps(url: string): Promise<PinnedPublicHttpUrl | null> {
  if (!url.startsWith('https://')) return null;
  return assertPublicHttpUrl(url).catch(() => null);
}

/**
 * Fetches an image an answer links to, on the renderer's behalf: https only, public addresses only (pinned against DNS
 * rebinding), no cookies, at most 5 MB and 10 s, and only bytes that sniff as a raster image.
 */
export async function fetchRemoteImage(url: string): Promise<RemoteImageResult> {
  let current = await pinHttps(url);
  if (!current) return { dataUrl: null, error: 'REMOTE_IMAGE_URL_DENIED' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      const response = await fetchPinnedPublic(current, {
        maxResponseBytes: REMOTE_IMAGE_MAX_BYTES,
        redirect: 'manual',
        signal: controller.signal,
        headers: { Accept: 'image/png,image/jpeg,image/gif,image/webp,image/*;q=0.8', 'User-Agent': 'RDC-Agent/RemoteImage' },
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        current = location ? await pinHttps(new URL(location, current.href).toString()) : null;
        if (!current) return { dataUrl: null, error: 'REMOTE_IMAGE_URL_DENIED' };
        continue;
      }
      if (!response.ok) return { dataUrl: null, error: 'REMOTE_IMAGE_UNAVAILABLE' };
      const bytes = await readLimitedBytes(response, REMOTE_IMAGE_MAX_BYTES);
      if (!bytes) return { dataUrl: null, error: 'REMOTE_IMAGE_TOO_LARGE' };
      const mime = sniffRasterImageMime(bytes);
      return mime ? { dataUrl: toDataUrl(bytes, mime) } : { dataUrl: null, error: 'REMOTE_IMAGE_TYPE_DENIED' };
    }
    return { dataUrl: null, error: 'REMOTE_IMAGE_UNAVAILABLE' };
  } catch {
    return { dataUrl: null, error: 'REMOTE_IMAGE_UNAVAILABLE' };
  } finally {
    clearTimeout(timer);
  }
}
