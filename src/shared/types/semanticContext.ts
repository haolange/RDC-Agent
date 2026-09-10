import type { ProviderCacheContract } from '../provider-catalog/modelManifestSchema';

export type StructuredHandoffKind =
  | 'derived-compaction'
  | 'model-transition'
  | 'agent-handoff';

export interface StructuredHandoffFact {
  text: string;
  source: 'user' | 'assistant' | 'tool';
  sourceRef?: string;
}

export interface StructuredHandoffResourceRef {
  kind: 'tool-call' | 'path' | 'url';
  value: string;
  sourceRef?: string;
}

export type StructuredHandoffDerivation = 'model-generated' | 'deterministic-extractive';

export interface StructuredHandoffProgress {
  done: StructuredHandoffFact[];
  inProgress: StructuredHandoffFact[];
  blocked: StructuredHandoffFact[];
}

export interface StructuredHandoff {
  schemaVersion: 1;
  handoffId: string;
  kind: StructuredHandoffKind;
  derivation: StructuredHandoffDerivation;
  objective: string;
  decisions: StructuredHandoffFact[];
  constraints: StructuredHandoffFact[];
  facts: StructuredHandoffFact[];
  openWork: StructuredHandoffFact[];
  progress?: StructuredHandoffProgress;
  failedAttempts?: StructuredHandoffFact[];
  nextSteps?: StructuredHandoffFact[];
  resourceRefs: StructuredHandoffResourceRef[];
  source: {
    sessionId?: string;
    branchId?: string;
    turnIds: string[];
    messageCount: number;
    messageHashes: string[];
    sourceHash: string;
  };
  contentHash: string;
}

export interface DerivedContextView {
  schemaVersion: 1;
  viewId: string;
  scope: 'ephemeral' | 'session';
  sessionId?: string;
  branchId?: string;
  sourceTurnIds: string[];
  retainedTurnIds: string[];
  sourceHash: string;
  handoff: StructuredHandoff;
  createdAt: number;
}

export interface DerivedContextMessageRef {
  viewId: string;
  handoffId: string;
  sourceHash: string;
}

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
