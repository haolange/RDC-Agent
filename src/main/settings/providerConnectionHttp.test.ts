import { afterEach, expect, it, vi } from 'vitest';
import { getJson } from './providerConnectionHttp';
afterEach(() => vi.unstubAllGlobals());
it('preserves HTTP authentication rejection as structured evidence', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 401 })));
  await expect(getJson('https://provider.test/models', {})).rejects.toMatchObject({ httpStatus: 401 });
});
