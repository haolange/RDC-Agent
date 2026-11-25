import type { ProviderCacheContract } from '../provider-catalog/modelManifestSchema';

export interface PromptStablePrefix {
  fingerprint: string;
  segmentIds: string[];
  sourceHashes: string[];
  tokenEstimate: number;
  volatileSegmentIds: string[];
}

export interface CompiledPromptCache {
  enabled: boolean;
  mode: ProviderCacheContract['mode'];
  keyCarrier: ProviderCacheContract['keyCarrier'];
  breakpointCarrier: ProviderCacheContract['breakpointCarrier'];
  ttl: ProviderCacheContract['ttl'];
  prefixFingerprint?: string;
  requestKey?: string;
  breakpoint: 'none' | 'implicit' | 'automatic' | 'explicit' | 'automatic-and-explicit';
  stableSegmentIds: string[];
  stableTokenEstimate: number;
  providerReported: boolean;
  reason: string;
}
