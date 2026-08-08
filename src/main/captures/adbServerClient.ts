import * as net from 'net';

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 5037;
const DEFAULT_TIMEOUT_MS = 2000;
const HOST_DEVICES_L = 'host:devices-l';

export class AdbServerUnreachableError extends Error {
  readonly code = 'server-unreachable' as const;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'AdbServerUnreachableError';
  }
}

export class AdbServerProtocolError extends Error {
  readonly code = 'protocol-failure' as const;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'AdbServerProtocolError';
  }
}

export interface QueryAdbDevicesOptions {
  timeoutMs?: number;
  /** Test seam — production always uses 127.0.0.1:5037. */
  host?: string;
  port?: number;
}

export interface AdbStartServerState {
  startServerAttempted: boolean;
}

function encodeAdbRequest(service: string): Buffer {
  const lengthHex = service.length.toString(16).padStart(4, '0');
  return Buffer.from(`${lengthHex}${service}`, 'utf8');
}

function isConnectUnreachable(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const code = (error as NodeJS.ErrnoException).code;
  return code === 'ECONNREFUSED'
    || code === 'ENOTFOUND'
    || code === 'EHOSTUNREACH'
    || code === 'ENETUNREACH'
    || code === 'ETIMEDOUT';
}

function destroySocket(socket: net.Socket): void {
  socket.removeAllListeners();
  socket.destroy();
}

function parseAdbDevicesResponse(buffer: Buffer): { done: true; payload: string } | { done: false } {
  if (buffer.length < 8) {
    return { done: false };
  }

  const status = buffer.subarray(0, 4).toString('ascii');
  const lengthHex = buffer.subarray(4, 8).toString('ascii');
  const payloadLength = Number.parseInt(lengthHex, 16);
  if (!Number.isFinite(payloadLength) || payloadLength < 0) {
    throw new AdbServerProtocolError(`Invalid ADB length prefix: ${lengthHex}`);
  }
  if (buffer.length < 8 + payloadLength) {
    return { done: false };
  }

  const payload = buffer.subarray(8, 8 + payloadLength).toString('utf8');
  if (status === 'OKAY') {
    return { done: true, payload };
  }
  if (status === 'FAIL') {
    throw new AdbServerProtocolError(payload.trim() || 'ADB server returned FAIL.');
  }
  throw new AdbServerProtocolError(`Unexpected ADB status: ${status}`);
}

/**
 * Query `host:devices-l` over the adb server TCP wire protocol (no process spawn).
 * Returns payload lines (same device-row format as `adb devices -l`, without the header).
 */
export async function queryAdbDevicesLines(options?: QueryAdbDevicesOptions): Promise<string[]> {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const host = options?.host ?? DEFAULT_HOST;
  const port = options?.port ?? DEFAULT_PORT;

  return new Promise<string[]>((resolve, reject) => {
    let settled = false;
    let timedOut = false;
    let received = Buffer.alloc(0);
    const socket = new net.Socket();

    const settle = (error: Error | null, lines?: string[]) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      destroySocket(socket);
      if (error) {
        reject(error);
        return;
      }
      resolve(lines ?? []);
    };

    const timer = setTimeout(() => {
      timedOut = true;
      settle(new AdbServerUnreachableError(
        `ADB server timed out after ${timeoutMs}ms (${host}:${port}).`,
      ));
    }, timeoutMs);

    const tryParse = () => {
      try {
        const parsed = parseAdbDevicesResponse(received);
        if (!parsed.done) {
          return;
        }
        const lines = parsed.payload.length === 0 ? [] : parsed.payload.split(/\r?\n/);
        settle(null, lines);
      } catch (error) {
        if (error instanceof AdbServerProtocolError) {
          settle(error);
          return;
        }
        settle(new AdbServerProtocolError(
          error instanceof Error ? error.message : String(error),
          { cause: error },
        ));
      }
    };

    socket.once('error', (error) => {
      if (timedOut) {
        return;
      }
      if (isConnectUnreachable(error)) {
        settle(new AdbServerUnreachableError(
          `ADB server unreachable at ${host}:${port}.`,
          { cause: error },
        ));
        return;
      }
      settle(new AdbServerProtocolError(
        error.message || 'ADB server socket error.',
        { cause: error },
      ));
    });

    socket.on('data', (chunk) => {
      received = Buffer.concat([received, chunk]);
      tryParse();
    });

    socket.once('close', () => {
      if (settled || timedOut) {
        return;
      }
      // Connection closed before a complete response — treat as protocol failure.
      try {
        const parsed = parseAdbDevicesResponse(received);
        if (parsed.done) {
          const lines = parsed.payload.length === 0 ? [] : parsed.payload.split(/\r?\n/);
          settle(null, lines);
          return;
        }
      } catch (error) {
        if (error instanceof AdbServerProtocolError) {
          settle(error);
          return;
        }
      }
      settle(new AdbServerProtocolError('ADB server closed the connection before the response completed.'));
    });

    socket.connect(port, host, () => {
      socket.write(encodeAdbRequest(HOST_DEVICES_L), (writeError) => {
        if (!writeError) {
          return;
        }
        settle(isConnectUnreachable(writeError)
          ? new AdbServerUnreachableError(
            `ADB server unreachable at ${host}:${port}.`,
            { cause: writeError },
          )
          : new AdbServerProtocolError(
            writeError.message || 'Failed to write ADB request.',
            { cause: writeError },
          ));
      });
    });
  });
}

/**
 * Steady-state device list: TCP first; on unreachable, optionally spawn start-server once then retry.
 */
export async function queryAdbDevicesLinesWithServerBootstrap(params: {
  queryLines: () => Promise<string[]>;
  startServer: () => Promise<unknown>;
  state: AdbStartServerState;
}): Promise<string[]> {
  try {
    return await params.queryLines();
  } catch (error) {
    if (!(error instanceof AdbServerUnreachableError)) {
      throw error;
    }
    if (params.state.startServerAttempted) {
      throw error;
    }
    params.state.startServerAttempted = true;
    await params.startServer();
    return await params.queryLines();
  }
}
