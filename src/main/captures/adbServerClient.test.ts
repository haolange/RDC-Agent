import * as net from 'net';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AdbServerProtocolError,
  AdbServerUnreachableError,
  queryAdbDevicesLines,
} from './adbServerClient';

async function listenEphemeral(
  handler: (socket: net.Socket) => void,
): Promise<{ port: number; close: () => Promise<void> }> {
  const sockets = new Set<net.Socket>();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.once('close', () => {
      sockets.delete(socket);
    });
    handler(socket);
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected TCP address for ephemeral mock server.');
  }
  return {
    port: address.port,
    close: () => new Promise((resolve, reject) => {
      for (const socket of sockets) {
        socket.destroy();
      }
      sockets.clear();
      server.close((error) => (error ? reject(error) : resolve()));
    }),
  };
}

function readSocketRequest(socket: net.Socket): Promise<string> {
  return new Promise((resolve, reject) => {
    let received = Buffer.alloc(0);
    const onData = (chunk: Buffer) => {
      received = Buffer.concat([received, chunk]);
      if (received.length >= 4) {
        const length = Number.parseInt(received.subarray(0, 4).toString('ascii'), 16);
        if (received.length >= 4 + length) {
          cleanup();
          resolve(received.subarray(0, 4 + length).toString('utf8'));
        }
      }
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      socket.off('data', onData);
      socket.off('error', onError);
    };
    socket.on('data', onData);
    socket.on('error', onError);
  });
}

describe('queryAdbDevicesLines', () => {
  const closers: Array<() => Promise<void>> = [];

  afterEach(async () => {
    while (closers.length > 0) {
      const close = closers.pop();
      await close?.();
    }
  });

  it('encodes host:devices-l and decodes OKAY payload lines', async () => {
    const payload = 'SERIAL1\tdevice product:foo model:Pixel device:bar\nSERIAL2\toffline\n';
    const lengthHex = payload.length.toString(16).padStart(4, '0');
    let request = '';

    const mock = await listenEphemeral((socket) => {
      void readSocketRequest(socket).then((value) => {
        request = value;
        socket.end(`OKAY${lengthHex}${payload}`);
      });
    });
    closers.push(mock.close);

    const lines = await queryAdbDevicesLines({ host: '127.0.0.1', port: mock.port, timeoutMs: 1000 });
    expect(request).toBe('000ehost:devices-l');
    expect(lines).toEqual([
      'SERIAL1\tdevice product:foo model:Pixel device:bar',
      'SERIAL2\toffline',
      '',
    ]);
  });

  it('maps FAIL responses to protocol-failure', async () => {
    const message = 'cannot connect';
    const lengthHex = message.length.toString(16).padStart(4, '0');
    const mock = await listenEphemeral((socket) => {
      void readSocketRequest(socket).then(() => {
        socket.end(`FAIL${lengthHex}${message}`);
      });
    });
    closers.push(mock.close);

    const rejection = queryAdbDevicesLines({ host: '127.0.0.1', port: mock.port, timeoutMs: 1000 });
    await expect(rejection).rejects.toBeInstanceOf(AdbServerProtocolError);
    await expect(rejection).rejects.toMatchObject({
      name: 'AdbServerProtocolError',
      code: 'protocol-failure',
      message,
    });
  });

  it('maps connection refused to AdbServerUnreachableError', async () => {
    const server = net.createServer();
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => resolve());
    });
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Expected TCP address.');
    }
    const port = address.port;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });

    const rejection = queryAdbDevicesLines({ host: '127.0.0.1', port, timeoutMs: 500 });
    await expect(rejection).rejects.toBeInstanceOf(AdbServerUnreachableError);
    await expect(rejection).rejects.toMatchObject({ code: 'server-unreachable' });
  });

  it('times out hung responses as AdbServerUnreachableError', async () => {
    const mock = await listenEphemeral((_socket) => {
      // Intentionally never respond.
    });
    closers.push(mock.close);

    await expect(queryAdbDevicesLines({ host: '127.0.0.1', port: mock.port, timeoutMs: 200 }))
      .rejects.toBeInstanceOf(AdbServerUnreachableError);
  });
});
