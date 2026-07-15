import { describe, expect, it } from 'vitest';
import { listProviderSummaries } from '../provider-catalog/ProviderCatalogRegistry';
import { buildProviderOperationTarget } from '../agent-runtime/providers/ProviderOperationRegistry';

function materializeContractBaseUrl(template: string): string {
  return template
    .replace(/^\$\{[^}]+\}/u, 'https://catalog-contract.example')
    .replace(/\$\{[^}]+\}/gu, 'catalog-contract');
}

describe('provider route URL contracts', () => {
  it('keeps every non-empty Anthropic-compatible base on an explicit versioned API path', () => {
    const invalid = listProviderSummaries().flatMap((surface) => surface.routes
      .filter((route) => route.protocol === 'AnthropicMessages' && route.baseUrl && !/\/v1(?:\/|$)/u.test(route.baseUrl))
      .map((route) => `${surface.id}: ${route.baseUrl}`));
    expect(invalid).toEqual([]);
  });

  it('builds one valid final operation URL for every stable Catalog route', () => {
    const targets = listProviderSummaries().flatMap((surface) => {
      if (surface.status !== 'stable') return [];
      const modelId = surface.models[0]?.modelId ?? 'catalog-contract-model';
      return surface.routes.map((route) => ({
        surfaceId: surface.id,
        routeId: route.id,
        target: buildProviderOperationTarget({
          adapterId: route.adapterId,
          protocol: route.protocol,
          baseUrl: materializeContractBaseUrl(route.baseUrl),
          modelId,
          connectionValues: { AICORE_DEPLOYMENT_ID: 'catalog-contract-deployment' },
        }),
      }));
    });
    expect(targets.length).toBeGreaterThan(200);
    for (const { surfaceId, routeId, target } of targets) {
      expect(() => new URL(target.url), `${surfaceId}/${routeId}: ${target.url}`).not.toThrow();
      const parsed = new URL(target.url);
      expect(['http:', 'https:', 'ws:', 'wss:'], `${surfaceId}/${routeId}`).toContain(parsed.protocol);
      expect(target.url, `${surfaceId}/${routeId}`).not.toMatch(
        /\/(?:chat\/completions|responses|messages)\/(?:chat\/completions|responses|messages)(?:\?|$)/u,
      );
      expect(target.operationBuilderId, `${surfaceId}/${routeId}`).toBeTruthy();
    }
  });
});
