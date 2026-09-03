import { describe, expect, it } from 'vitest';
import type { SemanticLaneStatus } from '@shared/types/embedding';
import {
  embeddingAvailabilityKey,
  embeddingAvailabilityOf,
  isSemanticLaneReady,
  semanticReasonKey,
} from './semanticLaneCopy';

function status(overrides: Partial<SemanticLaneStatus> = {}): SemanticLaneStatus {
  return {
    availability: 'unavailable',
    reason: 'unconfigured',
    selectedIdentity: null,
    selectedDimensions: null,
    snapshot: null,
    ...overrides,
  };
}

describe('isSemanticLaneReady', () => {
  it('requires both availability and reason to be ready', () => {
    expect(isSemanticLaneReady(null)).toBe(false);
    expect(isSemanticLaneReady(status({ availability: 'ready', reason: 'missing-snapshot' }))).toBe(false);
    expect(isSemanticLaneReady(status({ availability: 'stale', reason: 'ready' }))).toBe(false);
    expect(isSemanticLaneReady(status({ availability: 'ready', reason: 'ready' }))).toBe(true);
  });
});

describe('embeddingAvailabilityOf', () => {
  it('never reports ready for incomplete lane state', () => {
    expect(embeddingAvailabilityOf(null)).toBe('unavailable');
    expect(embeddingAvailabilityOf(status({ availability: 'ready', reason: 'consent-denied' }))).toBe('unavailable');
    expect(embeddingAvailabilityOf(status({ availability: 'stale', reason: 'identity-mismatch' }))).toBe('stale');
    expect(embeddingAvailabilityOf(status({ availability: 'ready', reason: 'ready' }))).toBe('ready');
  });
});

describe('semanticReasonKey', () => {
  it('maps unavailable, stale, and ready reasons without collapsing identity', () => {
    expect(semanticReasonKey(status())).toBe('knowledgeCenter.semanticReasonUnconfigured');
    expect(semanticReasonKey(status({ reason: 'consent-denied' }))).toBe('knowledgeCenter.semanticReasonConsentDenied');
    expect(semanticReasonKey(status({ availability: 'stale', reason: 'identity-mismatch' })))
      .toBe('knowledgeCenter.semanticReasonIdentityMismatch');
    expect(semanticReasonKey(status({ availability: 'stale', reason: 'invalid-vectors' })))
      .toBe('knowledgeCenter.semanticReasonInvalidVectors');
    expect(semanticReasonKey(status({ availability: 'ready', reason: 'ready' }))).toBe('settings.embeddingStatusReady');
  });
});

describe('embeddingAvailabilityKey', () => {
  it('keeps Settings copy aligned with the real lane availability', () => {
    expect(embeddingAvailabilityKey(null)).toBe('settings.embeddingStatusUnavailable');
    expect(embeddingAvailabilityKey(status({ availability: 'stale', reason: 'corpus-hash-mismatch' })))
      .toBe('settings.embeddingStatusStale');
    expect(embeddingAvailabilityKey(status({ availability: 'ready', reason: 'ready' })))
      .toBe('settings.embeddingStatusReady');
  });
});
