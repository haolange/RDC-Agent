import { describe, expect, it } from 'vitest';
import { evaluateDiscoveryAdmission } from './DiscoveryAdmission';

describe('discovery admission', () => {
  it.each([
    ['text model', { id: 'gpt-5.6', modality: 'text' }, true, undefined],
    ['embedding', { id: 'text-embedding-4' }, false, 'deny-pattern'],
    ['image modality', { id: 'renderer-v2', modality: 'image' }, false, 'modality'],
    ['allowlist miss', { id: 'other-model' }, false, 'allowlist'],
    ['unproven alias', { id: 'vendor-latest', type: 'alias' }, false, 'unproven-alias'],
    ['proven alias', { id: 'vendor-latest', type: 'alias', canonical_id: 'vendor-2026-07' }, true, undefined],
  ] as const)('%s', (_label, candidate, accepted, reason) => {
    expect(evaluateDiscoveryAdmission(candidate, {
      allowPatterns: candidate.id === 'other-model' ? ['gpt-*'] : undefined,
      allowedModalities: ['text'],
    })).toEqual({ accepted, ...(reason ? { reason } : {}) });
  });

  it('supports declarative deny patterns', () => {
    expect(evaluateDiscoveryAdmission({ id: 'vendor-preview' }, { denyPatterns: ['*-preview'] }))
      .toEqual({ accepted: false, reason: 'deny-pattern' });
  });
});
