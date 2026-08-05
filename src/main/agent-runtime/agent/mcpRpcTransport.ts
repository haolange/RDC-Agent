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
  ): Promise<unknown> {
    if (this.closed) {
      return Promise.reject(new Error('MCP connection is closed'));
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