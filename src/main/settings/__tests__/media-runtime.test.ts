import { MediaRuntimeService } from '../MediaRuntimeService';

describe('MediaRuntimeService (fail-closed)', () => {
  const service = new MediaRuntimeService();

  test('generate returns adapter-not-implemented for any request', async () => {
    const result = await service.generate({
      providerId: 'openai',
      modelId: 'dall-e-3',
      prompt: 'test prompt',
    });
    expect(result.status).toBe('adapter-not-implemented');
    expect(result.error).toContain('not implemented');
    expect(result.diagnostics?.providerId).toBe('openai');
    expect(result.diagnostics?.modelId).toBe('dall-e-3');
  });

  test('isMediaAdapterAvailable always returns false', () => {
    expect(service.isMediaAdapterAvailable('openai')).toBe(false);
    expect(service.isMediaAdapterAvailable('unknown-provider' as any)).toBe(false);
  });

  test('getRegisteredMediaProviders returns empty array', () => {
    expect(service.getRegisteredMediaProviders()).toEqual([]);
  });
});
