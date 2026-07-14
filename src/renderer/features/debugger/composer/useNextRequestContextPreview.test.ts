import { describe, expect, it } from 'vitest';
import type { NextRequestContextProjection } from '@shared/types/session';
import { shouldAcceptNextRequestContextProjection } from './useNextRequestContextPreview';

const projection = (clientRevision: number): NextRequestContextProjection => ({
  clientRevision,
  status: 'ready',
  route: { providerId: 'provider', modelId: 'model', protocol: 'OpenAIResponses' },
  contextMode: 'normal',
  estimatedInputTokens: 10,
  uncompactedInputTokens: 10,
  promptBudgetTokens: 1_000,
  contextWindowTokens: 2_000,
  usagePercent: 1,
  breakdown: [],
  willCompact: false,
  filteredArtifactCount: 0,
  estimatedAt: 1,
});

describe('next request context preview revision gate', () => {
  it('accepts only the latest matching A to B to C response', () => {
    expect(shouldAcceptNextRequestContextProjection(3, projection(1))).toBe(false);
    expect(shouldAcceptNextRequestContextProjection(3, projection(2))).toBe(false);
    expect(shouldAcceptNextRequestContextProjection(3, projection(3))).toBe(true);
  });
});
