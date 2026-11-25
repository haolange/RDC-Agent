import { useEffect, useRef, useState } from 'react';
import { RevisionLanes } from './revisionLanes';

export type AsyncValue<T> =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; value: T }
  | { status: 'error'; error: unknown };

const IDLE: AsyncValue<never> = { status: 'idle' };
const LOADING: AsyncValue<never> = { status: 'loading' };

interface AsyncValueOptions<T> {
  /** Releases a value nobody shows any more (an object URL): one that arrived late, or was replaced or unmounted. */
  dispose?: (value: T) => void;
}

/**
 * The value `read` resolves to for the current `key`: the renderer's one way to show an asynchronously read value.
 * Each key starts a read on the hook's revision lane and its answer applies only while that read is the newest, so a
 * slow read for an earlier key, or one that ends after unmount, changes nothing; the signal aborts the superseded
 * read's own work (a debounce timer). `null` reads nothing. What it returns always belongs to the current key: until
 * the key's read answers it is `loading`, never the previous key's value.
 */
export function useAsyncValue<T>(
  key: string | null,
  read: (signal: AbortSignal) => Promise<T>,
  options: AsyncValueOptions<T> = {},
): AsyncValue<T> {
  const readRef = useRef(read);
  const disposeRef = useRef(options.dispose);
  useEffect(() => {
    readRef.current = read;
    disposeRef.current = options.dispose;
  });
  const [lane] = useState(() => new RevisionLanes());
  /** The newest read begun; an answer shows only while it belongs to it (a key read again starts loading anew). */
  const revisionRef = useRef(0);
  const [state, setState] = useState<{ key: string; revision: number; value: AsyncValue<T> } | null>(null);
  useEffect(() => {
    if (key === null) return undefined;
    const revision = lane.begin('read');
    revisionRef.current = revision;
    const controller = new AbortController();
    let shown: { value: T } | null = null;
    readRef.current(controller.signal).then((value) => {
      if (!lane.isLatest('read', revision)) {
        disposeRef.current?.(value);
        return;
      }
      shown = { value };
      setState({ key, revision, value: { status: 'ready', value } });
    }, (error: unknown) => {
      if (lane.isLatest('read', revision)) setState({ key, revision, value: { status: 'error', error } });
    });
    return () => {
      lane.forget('read');
      revisionRef.current = 0;
      controller.abort();
      if (shown) disposeRef.current?.(shown.value);
    };
  }, [key, lane]);
  if (key === null) return IDLE;
  return state && state.key === key && state.revision === revisionRef.current ? state.value : LOADING;
}

/** Resolves after `ms`, or rejects at once when `signal` aborts: a debounce a superseded read gives up. */
export function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(signal.reason);
    }, { once: true });
  });
}
