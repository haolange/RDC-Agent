import type { ChildProcess } from 'child_process';
import { z } from 'zod';

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id?: number | string;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
  method?: string;
  params?: unknown;
}

export const MAX_MCP_BUFFER_BYTES = 1 * 1024 * 1024;

const JsonRpcResponseSchema = z.object({
  jsonrpc: z.literal('2.0'),
  id: z.union([z.number(), z.string()]).optional(),
  result: z.unknown().optional(),
  error: z.object({
    code: z.number(),
    message: z.string(),
    data: z.unknown().optional(),
  }).optional(),
  method: z.string().optional(),
  params: z.unknown().optional(),
});

export function parseJsonRpcResponse(line: string): JsonRpcResponse | null {
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    return null;
  }
  const parsed = JsonRpcResponseSchema.safeParse(raw);
  return parsed.success ? (parsed.data as JsonRpcResponse) : null;
}

export class StdioRpcClient {
  private nextId = 1;
  private buffer = '';
  private pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();
  private closed = false;

  constructor(private readonly proc: ChildProcess) {
    proc.stdout?.setEncoding('utf8');
    proc.stdout?.on('data', (chunk: string) => this.onData(chunk));
    proc.on('exit', () => this.onClose(new Error('MCP process exited')));
    proc.on('error', (err) => this.onClose(err));
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    if (Buffer.byteLength(this.buffer, 'utf8') > MAX_MCP_BUFFER_BYTES) {
      this.onClose(new Error(`MCP stdio buffer exceeded ${MAX_MCP_BUFFER_BYTES} bytes`));
      return;
    }
    let idx: number;
    while ((idx = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, idx).trim();
      this.buffer = this.buffer.slice(idx + 1);
      if (!line) continue;
      const msg = parseJsonRpcResponse(line);
      if (!msg) {
        continue;
      }
      if (typeof msg.id === 'number' && this.pending.has(msg.id)) {
        const entry = this.pending.get(msg.id)!;
        this.pending.delete(msg.id);
        if (msg.error) {
          entry.reject(
            new Error(`MCP error ${msg.error.code}: ${msg.error.message}`),
          );
        } else {
          entry.resolve(msg.result);
        }
      }
    }
  }

  private onClose(err: Error): void {
    if (this.closed) return;
    this.closed = true;
    for (const entry of this.pending.values()) {
      entry.reject(err);
    }
    this.pending.clear();
  }

  request(
    method: string,
    params: unknown,
    timeoutMs: number,
  ): Promise<unknown> {
    if (this.closed) {
      return Promise.reject(new Error('MCP connection is closed'));
    }
    const id = this.nextId++;
    const payload =
      JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';

    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`MCP request "${method}" timed out`));
        }
      }, timeoutMs);

      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });

      try {
        this.proc.stdin?.write(payload);
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  notify(method: string, params: unknown): void {
    if (this.closed) return;
    const payload = JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n';
    try {
      this.proc.stdin?.write(payload);
    } catch {
      // ignore notification failures
    }
  }

  close(): void {
    this.onClose(new Error('MCP client closed'));
  }
}

export class SseRpcClient {
  private nextId = 1;
  private pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();
  private closed = false;
  private abortController = new AbortController();

  constructor(private readonly baseUrl: string) {}

  async connect(_timeoutMs: number): Promise<void> {
    const response = await fetch(this.baseUrl, {
      method: 'GET',
      headers: { Accept: 'text/event-stream' },
      signal: this.abortController.signal,
    });

    if (!response.ok || !response.body) {
      throw new Error(`SSE connect failed: ${response.status} ${response.statusText}`);
    }

    void this.readSseStream(response.body);
  }

  private async readSseStream(body: ReadableStream<Uint8Array>): Promise<void> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let currentEvent = '';

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        if (Buffer.byteLength(buffer, 'utf8') > MAX_MCP_BUFFER_BYTES) {
          throw new Error(`MCP SSE buffer exceeded ${MAX_MCP_BUFFER_BYTES} bytes`);
        }

        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const rawLine of lines) {
          const line = rawLine.trimEnd();
          if (line === '') {
            if (currentEvent) {
              this.processEvent(currentEvent);
              currentEvent = '';
            }
            continue;
          }
          if (line.startsWith('data: ')) {
            currentEvent += line.slice(6);
          }
        }
      }
    } catch (err) {
      if (!this.closed) {
        this.onClose(
          err instanceof Error ? err : new Error(String(err)),
        );
      }
    } finally {
      try { reader.releaseLock(); } catch { /* ignore */ }
    }

    if (currentEvent) {
      this.processEvent(currentEvent);
    }
  }

  private processEvent(data: string): void {
    const msg = parseJsonRpcResponse(data);
    if (!msg) {
      return;
    }
    if (typeof msg.id === 'number' && this.pending.has(msg.id)) {
      const entry = this.pending.get(msg.id)!;
      this.pending.delete(msg.id);
      if (msg.error) {
        entry.reject(
          new Error(`MCP error ${msg.error.code}: ${msg.error.message}`),
        );
      } else {
        entry.resolve(msg.result);
      }
    }
  }

  private onClose(err: Error): void {
    if (this.closed) return;
    this.closed = true;
    for (const entry of this.pending.values()) {
      entry.reject(err);
    }
    this.pending.clear();
  }

  async request(
    method: string,
    params: unknown,
    timeoutMs: number,
  ): Promise<unknown> {
    if (this.closed) {
      return Promise.reject(new Error('SSE connection is closed'));
    }
    const id = this.nextId++;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(this.baseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`SSE POST ${res.status} ${res.statusText}`);
      }
      const rawBody = await res.json();
      const body = parseJsonRpcResponse(JSON.stringify(rawBody));
      if (!body) {
        throw new Error('MCP HTTP returned invalid JSON-RPC');
      }
      if (body.error) {
        throw new Error(
          `MCP error ${body.error.code}: ${body.error.message}`,
        );
      }
      return body.result;
    } finally {
      clearTimeout(timer);
    }
  }

  notify(method: string, params: unknown): void {
    if (this.closed) return;
    fetch(this.baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method, params }),
    }).catch(() => {
      /* ignore */
    });
  }

  close(): void {
    this.abortController.abort();
    this.onClose(new Error('SSE client closed'));
  }
}
