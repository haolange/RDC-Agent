import type { RendererEventChannel } from '@shared/renderer-api';

export interface BrowserBridgeEvent {
  channel: RendererEventChannel;
  args?: unknown[];
}

export interface EventStreamParser {
  /** Feeds decoded text and returns the events of every frame it completed. */
  push(text: string): BrowserBridgeEvent[];
}

/**
 * Incremental SSE framing. Only the text that arrived since the last push is scanned for a frame boundary, so a large
 * frame delivered in many chunks costs linear time; re-splitting the whole buffer per chunk was quadratic.
 */
export function createEventStreamParser(): EventStreamParser {
  let buffer = '';
  let scanFrom = 0;
  let pendingCarriageReturn = false;
  return {
    push(text) {
      // CRLF and lone CR both end a line; a CR at the end of a chunk may pair with an LF at the start of the next.
      let chunk = pendingCarriageReturn ? `\r${text}` : text;
      pendingCarriageReturn = chunk.endsWith('\r');
      if (pendingCarriageReturn) chunk = chunk.slice(0, -1);
      buffer += chunk.replace(/\r\n?/gu, '\n');
      const events: BrowserBridgeEvent[] = [];
      let frameStart = 0;
      for (;;) {
        const boundary = buffer.indexOf('\n\n', scanFrom);
        if (boundary < 0) break;
        const event = parseFrame(buffer.slice(frameStart, boundary));
        if (event) events.push(event);
        frameStart = boundary + 2;
        scanFrom = frameStart;
      }
      if (frameStart > 0) buffer = buffer.slice(frameStart);
      // The next boundary may begin with the last newline already buffered.
      scanFrom = Math.max(0, buffer.length - 1);
      return events;
    },
  };
}

function parseFrame(frame: string): BrowserBridgeEvent | null {
  const data = frame.split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())
    .join('\n');
  if (!data) return null;
  try {
    const parsed: unknown = JSON.parse(data);
    if (typeof parsed === 'object' && parsed !== null && typeof (parsed as { channel?: unknown }).channel === 'string') {
      return parsed as BrowserBridgeEvent;
    }
  } catch (error) {
    // A malformed frame is isolated; later valid frames on the same stream remain deliverable.
    console.warn('[BrowserAppBridge] Dropped a malformed event frame:', error);
  }
  return null;
}

function abortableDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) { resolve(); return; }
    const finish = () => { signal.removeEventListener('abort', onAbort); resolve(); };
    const timer = globalThis.setTimeout(finish, milliseconds);
    const onAbort = () => { globalThis.clearTimeout(timer); finish(); };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

export function connectBrowserEventStream(
  url: string,
  onEvent: (event: BrowserBridgeEvent) => void,
  fetchImpl: typeof fetch = fetch,
): () => void {
  const controller = new AbortController();
  // Read afresh at every check: abort() lands while a fetch, a read or a delay is awaited.
  const stopped = (): boolean => controller.signal.aborted;
  void (async () => {
    let retryDelay = 250;
    while (!stopped()) {
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
      try {
        const response = await fetchImpl(url, {
          method: 'POST',
          headers: { Accept: 'text/event-stream' },
          credentials: 'include',
          signal: controller.signal,
        });
        if (response.status === 401 || response.status === 403) {
          console.error(`[BrowserAppBridge] Event stream authorization failed: ${response.status}`);
          return;
        }
        if (!response.ok || !response.body) throw new Error(`Bridge event stream failed: ${response.status}`);
        retryDelay = 250;
        reader = response.body.getReader();
        const decoder = new TextDecoder();
        const parser = createEventStreamParser();
        while (!stopped()) {
          const chunk = await reader.read();
          if (stopped()) break;
          if (chunk.done) break;
          for (const event of parser.push(decoder.decode(chunk.value, { stream: true }))) {
            if (stopped()) break;
            try { onEvent(event); } catch (error) {
              console.error('[BrowserAppBridge] Event listener failed:', error);
            }
          }
        }
      } catch (error) {
        if (stopped()) break;
        console.warn('[BrowserAppBridge] Event stream disconnected:', error);
      } finally {
        if (reader) {
          await reader.cancel().catch(() => undefined);
          reader.releaseLock();
        }
      }
      await abortableDelay(retryDelay, controller.signal);
      retryDelay = Math.min(retryDelay * 2, 4000);
    }
  })().catch((error) => {
    if (!controller.signal.aborted) console.error('[BrowserAppBridge] Event stream failed:', error);
  });
  return () => controller.abort();
}
