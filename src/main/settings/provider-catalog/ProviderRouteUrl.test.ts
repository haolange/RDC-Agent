import { describe, expect, it } from 'vitest';
import { listProviderSummaries } from '../../provider-catalog/ProviderCatalogRegistry';
import { adapterOperationUrl } from '../../testing/contracts/providerOperationUrls';

function materializeContractBaseUrl(template: string): string {
  return template
    .replace(/^\$\{[^}]+\}/u, 'https://catalog-contract.example')
    .replace(/\$\{[^}]+\}/gu, 'catalog-contract');
}

describe('provider route URL contracts', () => {
  it('builds every Anthropic-compatible base into one versioned messages operation', () => {
    const invalid = listProviderSummaries().flatMap((surface) => surface.routes
      .filter((route) => route.protocol === 'AnthropicMessages' && route.baseUrl)
      .flatMap((route) => {
        const url = adapterOperationUrl(
          route.adapterId,
          materializeContractBaseUrl(route.baseUrl),
          surface.models[0]?.modelId ?? 'catalog-contract-model',
        );
        return url && /\/v\d+(?:\/[^/?#]+)*\/messages(?:\?|$)/u.test(new URL(url).pathname)
          ? []
          : [`${surface.id}: ${url}`];
      }));
    expect(invalid).toEqual([]);
  });

  it('builds one valid final operation URL for every stable HTTP Catalog route', () => {
    const targets = listProviderSummaries().flatMap((surface) => {
      if (surface.status !== 'stable') return [];
      const modelId = surface.models[0]?.modelId ?? 'catalog-contract-model';
      return surface.routes.flatMap((route) => {
        const url = adapterOperationUrl(route.adapterId, materializeContractBaseUrl(route.baseUrl), modelId);
        return url ? [{ surfaceId: surface.id, routeId: route.id, url }] : [];
      });
    });
    expect(targets.length).toBeGreaterThan(200);
    for (const { surfaceId, routeId, url } of targets) {
      expect(() => new URL(url), `${surfaceId}/${routeId}: ${url}`).not.toThrow();
      expect(['http:', 'https:'], `${surfaceId}/${routeId}`).toContain(new URL(url).protocol);
      expect(url, `${surfaceId}/${routeId}`).not.toMatch(
        /\/(?:chat\/completions|responses|messages)\/(?:chat\/completions|responses|messages)(?:\?|$)/u,
      );
    }
  });
});
