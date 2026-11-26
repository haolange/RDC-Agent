import { useCallback, useState } from 'react';
import { isSessionArtifactUri } from '@shared/types/sessionArtifact';
import { fetchRemoteImage } from '../../hooks/appShellBridge';
import { resolveConversationMedia } from '../../hooks/conversationPreview';
import { useAsyncValue } from '../../lib/useAsyncValue';

export type MarkdownMediaKind = 'image' | 'video';
export type MarkdownMediaState =
  | { status: 'loading' }
  | { status: 'ready'; url: string; kind: MarkdownMediaKind }
  /** A remote image whose URL only the model supplied: it waits for the person to ask. */
  | { status: 'unverified'; host: string }
  | { status: 'unavailable' };

type Resolved = { dataUrl: string; kind: MarkdownMediaKind } | { unverified: true } | null;

const CACHE_LIMIT = 48;
/** Resolved bytes survive remounts (virtualized transcript rows); object URLs are per mount and revoked on unmount. */
const cache = new Map<string, Promise<Resolved>>();

const remember = (key: string, load: () => Promise<Resolved>): Promise<Resolved> => {
  const cached = cache.get(key);
  if (cached) return cached;
  // A refusal, a dropped connection or an unverified URL is not remembered: the next mount asks again.
  const pending = load()
    .catch(() => null)
    .then((resolved) => {
      if (!resolved || 'unverified' in resolved) cache.delete(key);
      return resolved;
    });
  cache.set(key, pending);
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!);
  return pending;
};

/** Which channel a reference uses: https images through the main-process fetch, local references through resolveMedia. */
export function markdownMediaRoute(src: string): 'remote' | 'local' | null {
  const value = src.trim();
  if (!value) return null;
  if (value.startsWith('https://')) return 'remote';
  if (isSessionArtifactUri(value)) return 'local';
  if (/^[a-z]:[\\/]/i.test(value)) return 'local';
  return /^[a-z][a-z0-9+.-]*:/i.test(value) ? null : 'local';
}

const toObjectUrl = (dataUrl: string): string => {
  const [header, payload] = dataUrl.split(',', 2);
  const mime = /^data:([^;]+);base64$/.exec(header)?.[1] ?? 'application/octet-stream';
  const binary = atob(payload);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return URL.createObjectURL(new Blob([bytes], { type: mime }));
};

const UNAVAILABLE: MarkdownMediaState = { status: 'unavailable' };
const LOADING: MarkdownMediaState = { status: 'loading' };
const revokeShown = (state: MarkdownMediaState) => {
  if (state.status === 'ready') URL.revokeObjectURL(state.url);
};

export function useMarkdownMedia(
  src: string | undefined,
  sessionId: string | null,
): {
  media: MarkdownMediaState;
  /** Loads an unverified remote image because the person asked for it. */
  loadRequested: () => void;
} {
  const [requested, setRequested] = useState(false);
  const route = src ? markdownMediaRoute(src) : null;
  // The object URL lives while it shows: replaced, unmounted or late, it is revoked (a superseded read makes none).
  const read = useAsyncValue(
    src && route && sessionId ? JSON.stringify([sessionId, src, requested]) : null,
    async (signal) => {
      const resolved = await (route === 'remote'
        ? remember(`remote|${sessionId}|${src}`, async () => {
            // Asked for or not, a loaded image is remembered under the same key, so remounts reuse it.
            const result = await fetchRemoteImage({
              sessionId: sessionId!,
              url: src!,
              intent: requested ? 'click' : 'auto',
            });
            if (!result) return null;
            return 'unverified' in result ? result : { dataUrl: result.dataUrl, kind: 'image' };
          })
        : remember(`${sessionId}|${src}`, async () => {
            const result = await resolveConversationMedia({ sessionId: sessionId!, src: src! });
            return result?.dataUrl ? { dataUrl: result.dataUrl, kind: result.kind } : null;
          }));
      signal.throwIfAborted();
      if (!resolved) return UNAVAILABLE;
      if ('unverified' in resolved)
        return { status: 'unverified', host: new URL(src!).host } satisfies MarkdownMediaState;
      return { status: 'ready', url: toObjectUrl(resolved.dataUrl), kind: resolved.kind } satisfies MarkdownMediaState;
    },
    { dispose: revokeShown },
  );
  const media = read.status === 'ready' ? read.value : read.status === 'loading' ? LOADING : UNAVAILABLE;
  const loadRequested = useCallback(() => setRequested(true), []);
  return { media, loadRequested };
}
