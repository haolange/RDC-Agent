import { useEffect, useState } from 'react';
import { isSessionArtifactUri } from '@shared/types/sessionArtifact';
import { fetchRemoteImageDataUrl } from '../../hooks/appShellBridge';
import { resolveConversationMedia } from '../../hooks/conversationPreview';

export type MarkdownMediaKind = 'image' | 'video';
export type MarkdownMediaState =
  | { status: 'loading' }
  | { status: 'ready'; url: string; kind: MarkdownMediaKind }
  | { status: 'unavailable' };

type Resolved = { dataUrl: string; kind: MarkdownMediaKind } | null;

const CACHE_LIMIT = 48;
/** Resolved bytes survive remounts (virtualized transcript rows); object URLs are per mount and revoked on unmount. */
const cache = new Map<string, Promise<Resolved>>();

const remember = (key: string, load: () => Promise<Resolved>): Promise<Resolved> => {
  const cached = cache.get(key);
  if (cached) return cached;
  // A refusal or a dropped connection is not remembered: the next mount asks again.
  const pending = load().catch(() => null).then((resolved) => {
    if (!resolved) cache.delete(key);
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

export function useMarkdownMedia(src: string | undefined, sessionId: string | null): MarkdownMediaState {
  const [state, setState] = useState<MarkdownMediaState>({ status: 'loading' });
  useEffect(() => {
    const route = src ? markdownMediaRoute(src) : null;
    if (!src || !route || (route === 'local' && !sessionId)) {
      setState({ status: 'unavailable' });
      return undefined;
    }
    let cancelled = false;
    let objectUrl: string | null = null;
    setState({ status: 'loading' });
    const load = route === 'remote'
      ? remember(`remote|${src}`, async () => {
        const dataUrl = await fetchRemoteImageDataUrl(src);
        return dataUrl ? { dataUrl, kind: 'image' } : null;
      })
      : remember(`${sessionId}|${src}`, async () => {
        const result = await resolveConversationMedia({ sessionId: sessionId!, src });
        return result?.dataUrl ? { dataUrl: result.dataUrl, kind: result.kind } : null;
      });
    void load.then((resolved) => {
      if (cancelled) return;
      if (!resolved) {
        setState({ status: 'unavailable' });
        return;
      }
      objectUrl = toObjectUrl(resolved.dataUrl);
      setState({ status: 'ready', url: objectUrl, kind: resolved.kind });
    });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [src, sessionId]);
  return state;
}
