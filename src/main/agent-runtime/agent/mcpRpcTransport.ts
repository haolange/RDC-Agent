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

function serializeJsonRpcPayload(payload: Record<string, unknown>, suffix = ''): string {
  const body = JSON.stringify(payload) + suffix;
  if (Buffer.byteLength(body, 'utf8') > MAX_MCP_BUFFER_BYTES) {
    throw new Error(`MCP request exceeded ${MAX_MCP_BUFFER_BYTES} bytes`);
  }
  return body;
}
export async function readBoundedResponseBody(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) throw new Error('MCP HTTP response exceeded ' + maxBytes + ' bytes');
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(bytes);
}

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
    signal?: AbortSignal,
  ): Promise<unknown> {
    if (this.closed) {
      return Promise.reject(new Error('MCP connection is closed'));
    }
    if (signal?.aborted) {
      return Promise.reject(new DOMException('The operation was aborted', 'AbortError'));
    }
    const id = this.nextId++;
    const payload = serializeJsonRpcPayload({ jsonrpc: '2.0', id, method, params }, '\n');

    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`MCP request "${method}" timed out`));
        }
      }, timeoutMs);

      const cleanupAbort = () => {
        if (signal) {
          signal.removeEventListener('abort', onAbort);
        }
      };
      const onAbort = () => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          clearTimeout(timer);
          cleanupAbort();
          reject(new DOMException('The operation was aborted', 'AbortError'));
        }
      };
      if (signal) {
        signal.addEventListener('abort', onAbort, { once: true });
      }

      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          cleanupAbort();
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          cleanupAbort();
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
    const payload = serializeJsonRpcPayload({ jsonrpc: '2.0', method, params }, '\n');
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

interface JsonRpcPost {
  url: string;
  method: string;
  params: unknown;
  timeoutMs: number;
  signal?: AbortSignal;
}

async function withRpcDeadline<T>(request: JsonRpcPost, run: (signal: AbortSignal, id: number) => Promise<T>): Promise<T> {
  const timeout = AbortSignal.timeout(request.timeoutMs);
  const signal = request.signal ? AbortSignal.any([timeout, request.signal]) : timeout;
  const id = Date.now() + Math.floor(Math.random() * 1000);
  return run(signal, id);
}

/** http transport: one JSON-RPC POST, one JSON response body. */
export function postJsonRpc(url: string, method: string, params: unknown, timeoutMs: number, signal?: AbortSignal): Promise<unknown> {
  return withRpcDeadline({ url, method, params, timeoutMs, signal }, async (linked, id) => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
      signal: linked,
    });
    if (!res.ok) throw new Error(`MCP HTTP ${res.status} ${res.statusText}`);
    const body = parseJsonRpcResponse(await readBoundedResponseBody(res, MAX_MCP_BUFFER_BYTES));
    if (!body) throw new Error('MCP HTTP returned invalid JSON-RPC');
    if (body.error) throw new Error(`MCP error ${body.error.code}: ${body.error.message}`);
    return body.result;
  });
}

/** streamable-http transport: POST with an NDJSON response; returns the frame matching the request id. */
export function postStreamableJsonRpc(url: string, method: string, params: unknown, timeoutMs: number, signal?: AbortSignal): Promise<unknown> {
  return withRpcDeadline({ url, method, params, timeoutMs, signal }, async (linked, id) => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson' },
      body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
      signal: linked,
    });
    if (!res.ok) throw new Error(`MCP streamable-http ${res.status} ${res.statusText}`);
    // Read once; the bounded reader caps the cumulative stream so many small
    // NDJSON frames cannot bypass the response limit.
    const rawBody = await readBoundedResponseBody(res, MAX_MCP_BUFFER_BYTES);
    let sawJsonRpcMessage = false;
    for (const line of rawBody.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const msg = parseJsonRpcResponse(trimmed);
      if (!msg) throw new Error('MCP streamable-http returned invalid JSON-RPC');
      if (msg.error) throw new Error(`MCP error ${msg.error.code}: ${msg.error.message}`);
      if (typeof msg.id === 'number' || typeof msg.id === 'string') {
        sawJsonRpcMessage = true;
        if (msg.id === id) return msg.result;
      }
    }
    if (!sawJsonRpcMessage) throw new Error('MCP streamable-http returned no JSON-RPC response');
    throw new Error('MCP streamable-http response id mismatch');
  });
}