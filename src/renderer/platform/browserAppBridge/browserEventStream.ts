import type { RendererEventChannel } from '@shared/renderer-api';

export interface BrowserBridgeEvent {
  channel: RendererEventChannel;
  args?: unknown[];
}

export function parseEventStreamChunk(buffer: string): { events: BrowserBridgeEvent[]; remainder: string } {
  const normalized = buffer.replace(/\r\n/gu, '\n');
  const frames = normalized.split('\n\n');
  const remainder = frames.pop() ?? '';
  const events: BrowserBridgeEvent[] = [];
  for (const frame of frames) {
    const data = frame.split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n');
    if (!data) continue;
    try {
      const parsed = JSON.parse(data) as Partial<BrowserBridgeEvent>;
      if (typeof parsed.channel === 'string') events.push(parsed as BrowserBridgeEvent);
    } catch {
      // A malformed frame is isolated; later valid frames on the same stream remain deliverable.
    }
  }
  return { events, remainder };
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
  void (async () => {
    let retryDelay = 250;
    while (!controller.signal.aborted) {
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
        let buffer = '';
        while (!controller.signal.aborted) {
          const chunk = await reader.read();
          if (controller.signal.aborted) break;
          if (chunk.done) break;
          buffer += decoder.decode(chunk.value, { stream: true });
          const parsed = parseEventStreamChunk(buffer);
          buffer = parsed.remainder;
          for (const event of parsed.events) {
            if (controller.signal.aborted) break;
            try { onEvent(event); } catch (error) {
              console.error('[BrowserAppBridge] Event listener failed:', error);
            }
          }
        }
      } catch (error) {
        if (controller.signal.aborted) break;
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
