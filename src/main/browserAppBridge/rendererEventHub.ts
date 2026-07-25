import type { ServerResponse } from 'http';

type EventPayload = {
  channel: string;
  args: unknown[];
};

const clients = new Set<ServerResponse>();

function writeEvent(response: ServerResponse, payload: EventPayload): void {
  response.write(`data: ${JSON.stringify(payload)}\n\n`);
}

export const rendererEventHub = {
  emit(channel: string, ...args: unknown[]): void {
    const payload = { channel, args };
    for (const client of clients) {
      writeEvent(client, payload);
    }
  },

  connect(response: ServerResponse, allowedOrigin?: string): () => void {
    const headers: Record<string, string> = {
      'Cache-Control': 'no-store',
      'Content-Type': 'text/event-stream; charset=utf-8',
      Connection: 'keep-alive',
    };
    if (allowedOrigin) {
      headers['Access-Control-Allow-Origin'] = allowedOrigin;
      headers.Vary = 'Origin';
    }
    response.writeHead(200, headers);
    response.write('retry: 1000\n\n');
    clients.add(response);

    const heartbeat = setInterval(() => {
      response.write(':\n\n');
    }, 15000);

    const disconnect = (): void => {
      clearInterval(heartbeat);
      clients.delete(response);
    };

    response.on('close', disconnect);
    return disconnect;
  },
};
