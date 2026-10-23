import * as http from 'node:http';
import { describe, expect, it } from 'vitest';
import { fetchPinnedPublic } from './assertPublicHttpUrl';

describe('pinned HTTP receive bound', () => {
  it('aborts a chunked response before accumulating bytes beyond the caller limit', async () => {
    const server = http.createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.end('x'.repeat(1024 * 1024));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected a TCP fixture.');
    try {
      // Transport-only fixture: no product DNS or public-address validation is bypassed.
      await expect(fetchPinnedPublic({
        href: `http://example.test:${address.port}/large`, hostname: 'example.test',
        protocol: 'http:', port: String(address.port), pinnedAddress: '127.0.0.1',
        family: 4, pinnedAddresses: ['127.0.0.1'],
      }, { maxResponseBytes: 64 })).rejects.toThrow(/64 byte source limit/);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
