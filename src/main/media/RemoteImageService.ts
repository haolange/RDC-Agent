import { fetchPublic, PublicUrlDeniedError } from '../runtime/net/publicEgress';
import { readLimitedBytes, sniffRasterImageMime, toDataUrl } from './mediaBytes';

export const REMOTE_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 3;

export type RemoteImageResult = { dataUrl: string } | { dataUrl: null; error: RemoteImageError };
export type RemoteImageError =
  | 'REMOTE_IMAGE_URL_DENIED'
  | 'REMOTE_IMAGE_UNAVAILABLE'
  | 'REMOTE_IMAGE_TOO_LARGE'
  | 'REMOTE_IMAGE_TYPE_DENIED'
  | 'REMOTE_IMAGE_UNVERIFIED';

/**
 * Fetches an image an answer links to, on the renderer's behalf: https only on every hop, public addresses only (pinned
 * against DNS rebinding), no cookies, at most 5 MB and 10 s, and only bytes that sniff as a raster image.
 */
export async function fetchRemoteImage(url: string): Promise<RemoteImageResult> {
  let fetched;
  try {
    fetched = await fetchPublic(url, {
      accept: 'image/png,image/jpeg,image/gif,image/webp,image/*;q=0.8',
      userAgent: 'RDC-Agent/RemoteImage',
      maxResponseBytes: REMOTE_IMAGE_MAX_BYTES,
      maxRedirects: MAX_REDIRECTS,
      timeoutMs: REQUEST_TIMEOUT_MS,
      httpsOnly: true,
    });
  } catch (error) {
    return {
      dataUrl: null,
      error: error instanceof PublicUrlDeniedError ? 'REMOTE_IMAGE_URL_DENIED' : 'REMOTE_IMAGE_UNAVAILABLE',
    };
  }
  const { response } = fetched;
  if (!response.ok) return { dataUrl: null, error: 'REMOTE_IMAGE_UNAVAILABLE' };
  const bytes = await readLimitedBytes(response, REMOTE_IMAGE_MAX_BYTES);
  if (!bytes) return { dataUrl: null, error: 'REMOTE_IMAGE_TOO_LARGE' };
  const mime = sniffRasterImageMime(bytes);
  return mime ? { dataUrl: toDataUrl(bytes, mime) } : { dataUrl: null, error: 'REMOTE_IMAGE_TYPE_DENIED' };
}
