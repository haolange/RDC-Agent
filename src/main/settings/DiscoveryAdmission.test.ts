import { describe, expect, it } from 'vitest';
import { evaluateDiscoveryAdmission, extractDiscoveredModelIdentity } from './DiscoveryAdmission';

describe('discovery admission', () => {
  it.each([
    ['text model', { id: 'gpt-5.6', modality: 'text' }, true, undefined],
    ['embedding', { id: 'text-embedding-4' }, false, 'deny-pattern'],
    ['image modality', { id: 'renderer-v2', modality: 'image' }, false, 'modality'],
    ['nested embedding type', { id: 'vector-v2', capabilities: { type: 'embeddings' } }, false, 'modality'],
    ['audio output', { id: 'voice-v2', output_modalities: ['audio'] }, false, 'modality'],
    ['video generation', { id: 'grok-imagine-video-1.5', output_modalities: ['video'] }, false, 'deny-pattern'],
    ['vision chat', { id: 'vision-image-chat', input_modalities: ['text', 'image'], output_modalities: ['text'] }, true, undefined],
    ['image generation', { id: 'gpt-image-1', input_modalities: ['text', 'image'], output_modalities: ['image'] }, false, 'deny-pattern'],
    ['vision chat input', { id: 'vision-chat', input_modalities: ['text', 'image'], output_modalities: ['text'] }, true, undefined],
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

  it('normalizes a proven alias to its canonical id without treating it as another model', () => {
    expect(extractDiscoveredModelIdentity({
      id: 'vendor-latest', type: 'alias', canonical_id: 'vendor-2026-07',
    })).toEqual({ id: 'vendor-2026-07', aliases: ['vendor-latest'] });
  });
});
