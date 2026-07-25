import { describe, expect, it } from 'vitest';
import {
  resolveCacheRetention,
  anthropicCacheControlForRetention,
  openAICacheWireForRetention,
} from './promptCacheWire';
import {
  normalizeCacheUsage,
  finalizeProviderUsage,
  splitAnthropicCacheWrite,
  cacheHitRatePercent,
} from './internal/normalizeCacheUsage';
import type {
  CredentialStore,
  ProviderCredential,
  ApiKeyAuth,
  OAuthAuth,
  ProviderAuth,
} from '../../settings/CredentialStoreInterface';
import openrouterManifest from '@shared/provider-catalog/manifests/surfaces/openrouter.json';

// =====================================================================
// 1. Cache retention resolution
// =====================================================================

describe('resolveCacheRetention', () => {
  it('maps "none" TTL to "none" retention', () => {
    expect(resolveCacheRetention('none')).toBe('none');
  });

  it('maps "five-minutes" TTL to "short" retention', () => {
    expect(resolveCacheRetention('five-minutes')).toBe('short');
  });

  it('maps "thirty-minutes" TTL to "short" retention', () => {
    expect(resolveCacheRetention('thirty-minutes')).toBe('short');
  });

  it('maps "one-hour" TTL to "long" retention', () => {
    expect(resolveCacheRetention('one-hour')).toBe('long');
  });

  it('maps "twenty-four-hours" TTL to "long" retention', () => {
    expect(resolveCacheRetention('twenty-four-hours')).toBe('long');
  });

  it('maps "provider-managed" TTL to "short" retention', () => {
    expect(resolveCacheRetention('provider-managed')).toBe('short');
  });

  it('maps "unknown" TTL to "short" retention', () => {
    expect(resolveCacheRetention('unknown')).toBe('short');
  });
});

// =====================================================================
// 2. Anthropic cache control wire format
// =====================================================================

describe('anthropicCacheControlForRetention', () => {
  it('returns undefined for "none" retention (no cache marker)', () => {
    expect(anthropicCacheControlForRetention('none')).toBeUndefined();
  });

  it('returns ephemeral without TTL for "short" retention', () => {
    const wire = anthropicCacheControlForRetention('short');
    expect(wire).toEqual({ type: 'ephemeral' });
    expect(wire!.ttl).toBeUndefined();
  });

  it('returns ephemeral with 1h TTL for "long" retention', () => {
    const wire = anthropicCacheControlForRetention('long');
    expect(wire).toEqual({ type: 'ephemeral', ttl: '1h' });
  });
});

// =====================================================================
// 3. OpenAI cache wire format
// =====================================================================

describe('openAICacheWireForRetention', () => {
  it('returns empty object for "none" retention', () => {
    expect(openAICacheWireForRetention('none')).toEqual({});
    expect(openAICacheWireForRetention('none', 'some-key')).toEqual({});
  });

  it('returns prompt cache key for "short" retention', () => {
    const wire = openAICacheWireForRetention('short', 'rdc:abc123');
    expect(wire).toEqual({ promptCacheKey: 'rdc:abc123' });
    expect(wire.promptCacheRetention).toBeUndefined();
  });

  it('returns key + 24h retention for "long" retention', () => {
    const wire = openAICacheWireForRetention('long', 'rdc:xyz');
    expect(wire).toEqual({ promptCacheKey: 'rdc:xyz', promptCacheRetention: '24h' });
  });

  it('omits key when not provided', () => {
    const wire = openAICacheWireForRetention('long');
    expect(wire).toEqual({ promptCacheRetention: '24h' });
  });
});

// =====================================================================
// 4. normalizeCacheUsage with cacheWriteLongTokens
// =====================================================================

describe('normalizeCacheUsage', () => {
  it('resolves native hit/miss tokens', () => {
    const result = normalizeCacheUsage({
      inputTokens: 1000,
      promptCacheHitTokens: 800,
      promptCacheMissTokens: 200,
    });
    expect(result).toEqual({ cacheHitTokens: 800, cacheMissTokens: 200 });
  });

  it('derives miss from inputTokens - cacheReadTokens', () => {
    const result = normalizeCacheUsage({
      inputTokens: 1000,
      cacheReadTokens: 600,
    });
    expect(result).toEqual({ cacheHitTokens: 600, cacheMissTokens: 400 });
  });

  it('returns empty when no cache telemetry', () => {
    const result = normalizeCacheUsage({ inputTokens: 500 });
    expect(result).toEqual({});
  });
});

describe('finalizeProviderUsage', () => {
  it('propagates cacheWriteLongTokens when present', () => {
    const usage = finalizeProviderUsage({
      inputTokens: 1000,
      outputTokens: 200,
      cacheReadTokens: 700,
      cacheWriteTokens: 300,
      cacheWriteLongTokens: 150,
    });
    expect(usage.cacheWriteLongTokens).toBe(150);
    expect(usage.cacheWriteTokens).toBe(300);
    expect(usage.cacheReadTokens).toBe(700);
    expect(usage.cacheHitTokens).toBe(700);
    expect(usage.cacheMissTokens).toBe(300);
  });

  it('omits cacheWriteLongTokens when absent', () => {
    const usage = finalizeProviderUsage({
      inputTokens: 500,
      outputTokens: 100,
      cacheWriteTokens: 50,
    });
    expect(usage.cacheWriteLongTokens).toBeUndefined();
    expect(usage.cacheWriteTokens).toBe(50);
  });

  it('computes totalTokens when not provided', () => {
    const usage = finalizeProviderUsage({
      inputTokens: 800,
      outputTokens: 200,
    });
    expect(usage.totalTokens).toBe(1000);
  });
});

// =====================================================================
// 5. splitAnthropicCacheWrite
// =====================================================================

describe('splitAnthropicCacheWrite', () => {
  it('returns only cacheWriteTokens when no long-lived write', () => {
    const result = splitAnthropicCacheWrite(500, undefined);
    expect(result).toEqual({ cacheWriteTokens: 500 });
  });

  it('returns only cacheWriteTokens when long-lived write is zero', () => {
    const result = splitAnthropicCacheWrite(500, 0);
    expect(result).toEqual({ cacheWriteTokens: 500 });
  });

  it('splits long-lived portion from total cache write', () => {
    const result = splitAnthropicCacheWrite(500, 200);
    expect(result).toEqual({ cacheWriteTokens: 500, cacheWriteLongTokens: 200 });
  });

  it('clamps long-lived write to total when it exceeds', () => {
    const result = splitAnthropicCacheWrite(300, 999);
    expect(result).toEqual({ cacheWriteTokens: 300, cacheWriteLongTokens: 300 });
  });
});

// =====================================================================
// 6. cacheHitRatePercent
// =====================================================================

describe('cacheHitRatePercent', () => {
  it('returns undefined when denominator is zero', () => {
    expect(cacheHitRatePercent(0, 0)).toBeUndefined();
  });

  it('computes correct percentage', () => {
    expect(cacheHitRatePercent(75, 25)).toBe(75);
    expect(cacheHitRatePercent(100, 0)).toBe(100);
    expect(cacheHitRatePercent(0, 100)).toBe(0);
  });
});

// =====================================================================
// 7. CredentialStoreInterface type conformance (compile-time + runtime)
// =====================================================================

describe('CredentialStoreInterface', () => {
  it('CredentialStore interface is structurally implementable', () => {
    const store = new Map<string, ProviderCredential>();
    const impl: CredentialStore = {
      async read(providerId: string) {
        return store.get(providerId);
      },
      async modify(providerId, fn) {
        const current = store.get(providerId);
        const next = await fn(current);
        if (next === undefined) {
          store.delete(providerId);
        } else {
          store.set(providerId, next);
        }
        return next;
      },
      async delete(providerId: string) {
        store.delete(providerId);
      },
    };

    // Verify the interface is callable
    expect(impl.read).toBeTypeOf('function');
    expect(impl.modify).toBeTypeOf('function');
    expect(impl.delete).toBeTypeOf('function');
  });

  it('ApiKeyAuth interface is structurally implementable', () => {
    const auth: ApiKeyAuth = {
      name: 'test-key-auth',
      async resolve({ modelId, providerId }) {
        if (providerId === 'openai') return { apiKey: 'sk-test', baseUrl: undefined };
        if (modelId === 'custom') return { apiKey: 'sk-custom', baseUrl: 'https://custom.api' };
        return undefined;
      },
    };
    expect(auth.name).toBe('test-key-auth');
    expect(auth.resolve).toBeTypeOf('function');
  });

  it('OAuthAuth interface is structurally implementable', () => {
    const auth: OAuthAuth = {
      name: 'test-oauth',
      async login() {
        return { token: 'oauth-token-123' };
      },
      async refresh(credential) {
        return { token: `${credential.token}-refreshed` };
      },
      async toAuth(credential) {
        return { apiKey: credential.token, headers: { Authorization: `Bearer ${credential.token}` } };
      },
    };
    expect(auth.name).toBe('test-oauth');
    expect(auth.login).toBeTypeOf('function');
    expect(auth.refresh).toBeTypeOf('function');
    expect(auth.toAuth).toBeTypeOf('function');
  });

  it('ProviderAuth composes apiKey and oauth', () => {
    const providerAuth: ProviderAuth = {
      apiKey: {
        name: 'key',
        resolve: async () => ({ apiKey: 'k' }),
      },
      oauth: {
        name: 'oauth',
        login: async () => ({ token: 't' }),
        refresh: async (c) => ({ token: c.token }),
        toAuth: async (c) => ({ apiKey: c.token }),
      },
    };
    expect(providerAuth.apiKey).toBeDefined();
    expect(providerAuth.oauth).toBeDefined();
  });
});

// =====================================================================
// 8. OpenRouter manifest admission policy
// =====================================================================

describe('OpenRouter manifest admission policy', () => {
  const discovery = (openrouterManifest as Record<string, unknown>).discovery as Record<string, unknown>;
  const admission = discovery.admission as Record<string, unknown>;

  it('has an admission section in discovery', () => {
    expect(admission).toBeDefined();
    expect(typeof admission).toBe('object');
  });

  it('allows top-tier providers', () => {
    const allowProviders = admission.allowProviders as string[];
    expect(allowProviders).toContain('openai');
    expect(allowProviders).toContain('anthropic');
    expect(allowProviders).toContain('google');
    expect(allowProviders).toContain('deepseek');
    expect(allowProviders).toContain('qwen');
    expect(allowProviders).toContain('mistralai');
    expect(allowProviders).toContain('x-ai');
    expect(allowProviders).toContain('moonshotai');
    expect(allowProviders).toContain('meta-llama');
    expect(allowProviders).toContain('thudm');
  });

  it('denies free/deprecated/legacy/experimental models', () => {
    const denyPatterns = admission.denyPatterns as string[];
    expect(denyPatterns).toContain(':free$');
    expect(denyPatterns).toContain('-deprecated$');
    expect(denyPatterns).toContain('-legacy$');
    expect(denyPatterns).toContain('-experimental$');
  });

  it('denies known low-quality/unknown providers', () => {
    const denyPatterns = admission.denyPatterns as string[];
    expect(denyPatterns.some((p) => p.includes('huggingfaceh4'))).toBe(true);
    expect(denyPatterns.some((p) => p.includes('gryphe'))).toBe(true);
    expect(denyPatterns.some((p) => p.includes('mancer'))).toBe(true);
  });

  it('requires tool-calling capability', () => {
    const requireCapabilities = admission.requireCapabilities as string[];
    expect(requireCapabilities).toContain('toolCalling');
  });

  it('requires explicit context window', () => {
    expect(admission.requireContextWindow).toBe(true);
  });

  it('excludes deprecated and experimental models', () => {
    expect(admission.excludeDeprecated).toBe(true);
    expect(admission.excludeExperimental).toBe(true);
  });
});
