import { requestPinned } from './pinnedTransport';
import { pinPublicUrl, PublicUrlDeniedError } from './publicAddress';

export { PublicUrlDeniedError } from './publicAddress';

/** The request to a validated public address did not complete: network failure, timeout, abort or a broken redirect. */
export class PublicRequestFailedError extends Error {
  constructor(
    readonly url: string,
    cause: unknown,
  ) {
    super(`Public request to ${url} failed: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
  }
}

export interface PublicFetchOptions {
  accept: string;
  userAgent: string;
  maxResponseBytes: number;
  maxRedirects: number;
  timeoutMs: number;
  /** Every hop, redirects included, must stay on https. */
  httpsOnly?: boolean;
  signal?: AbortSignal;
}

export interface PublicFetchResult {
  response: Response;
  finalUrl: string;
}

/**
 * The one way main reaches the public web for content (web_fetch, web_search, remote images, favicons). Each hop is
 * validated and DNS-pinned before connecting, redirects are followed manually and re-validated, cookies are never sent,
 * and the body is bounded while it is received. A URL or redirect target that is not public raises
 * `PublicUrlDeniedError` before any byte is sent to it; a failure after validation raises `PublicRequestFailedError`.
 */
export async function fetchPublic(rawUrl: string, options: PublicFetchOptions): Promise<PublicFetchResult> {
  options.signal?.throwIfAborted();
  let current = await pinPublicUrl(rawUrl, { httpsOnly: options.httpsOnly });
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error(`Timed out after ${options.timeoutMs}ms`)),
    options.timeoutMs,
  );
  const abort = (): void => controller.abort(options.signal?.reason ?? new Error('Request aborted'));
  options.signal?.addEventListener('abort', abort, { once: true });
  try {
    for (let hop = 0; hop <= options.maxRedirects; hop += 1) {
      let response: Response;
      try {
        response = await requestPinned(current, {
          redirect: 'manual',
          signal: controller.signal,
          maxResponseBytes: options.maxResponseBytes,
          headers: { Accept: options.accept, 'User-Agent': options.userAgent },
        });
      } catch (error) {
        throw new PublicRequestFailedError(current.href, error);
      }
      if (response.status < 300 || response.status >= 400) return { response, finalUrl: current.href };
      const location = response.headers.get('location');
      if (!location) throw new PublicRequestFailedError(current.href, new Error('Redirect missing Location header'));
      current = await pinPublicUrl(new URL(location, current.href).toString(), { httpsOnly: options.httpsOnly });
    }
    throw new PublicRequestFailedError(current.href, new Error(`Too many redirects (>${options.maxRedirects})`));
  } catch (error) {
    if (error instanceof PublicUrlDeniedError || error instanceof PublicRequestFailedError) throw error;
    throw new PublicRequestFailedError(current.href, error);
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', abort);
  }
}
