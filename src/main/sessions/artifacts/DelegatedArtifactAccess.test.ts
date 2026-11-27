import { describe, expect, it, vi } from 'vitest';
import { createInvestigationHarness, SESSION_ID } from '../../testing/investigationTestFixtures';
import {
  assertGrantBindsVersion,
  grantDelegatedArtifactAccess,
  resolveDelegatedArtifactRead,
  assertDelegatedArtifactWrite,
  grantDelegatedOutput,
} from './DelegatedArtifactAccess';
import type { SessionArtifactResolver } from './SessionArtifactResolver';
const uri = 'session://tool-outputs/a.md';
const hash = 'a'.repeat(64);
describe('delegated artifact grants', () => {
  it('freezes root ownership/hash and refuses sibling or nested scope expansion', () => {
    const read = vi.fn(() => ({ hash })) as unknown as SessionArtifactResolver['read'];
    const release = grantDelegatedArtifactAccess('child', 'root', [uri], { read });
    try {
      expect(() => assertDelegatedArtifactWrite('child', uri)).toThrow(/does not authorize/);
      grantDelegatedOutput('child', 'session://investigation/new.json', hash);
      expect(() => assertDelegatedArtifactWrite('child', 'session://investigation/new.json')).not.toThrow();
      expect(resolveDelegatedArtifactRead('child', uri)).toEqual({ sessionId: 'root', expectedHash: hash });
      expect(() => resolveDelegatedArtifactRead('child', 'session://tool-outputs/sibling.md', 'b'.repeat(64))).toThrow(
        /ARTIFACT_SESSION_DENIED/,
      );
      expect(() => resolveDelegatedArtifactRead('child', uri, 'b'.repeat(64))).toThrow(/ARTIFACT_HASH_MISMATCH/);
      expect(resolveDelegatedArtifactRead('child', uri, `sha256:${hash}`)).toEqual({
        sessionId: 'root',
        expectedHash: hash,
      });
      expect(() =>
        grantDelegatedArtifactAccess('grandchild', 'child', ['session://tool-outputs/sibling.md'], { read }),
      ).toThrow(/exceeds/);
    } finally {
      release();
    }
    expect(resolveDelegatedArtifactRead('child', uri).sessionId).toBe('child');
  });
  it('propagates only verified child-created outputs to its immediate parent after release', () => {
    const read = vi.fn(() => ({ hash })) as unknown as SessionArtifactResolver['read'];
    const releaseParent = grantDelegatedArtifactAccess('parent-child', 'root', [uri], { read });
    const releaseNested = grantDelegatedArtifactAccess('nested', 'parent-child', [uri], { read });
    try {
      const output = 'session://investigation/nested-output.json';
      grantDelegatedOutput('nested', output, hash);
      expect(() => resolveDelegatedArtifactRead('parent-child', output)).toThrow();
      releaseNested();
      expect(resolveDelegatedArtifactRead('parent-child', output)).toEqual({ sessionId: 'root', expectedHash: hash });
      expect(() => resolveDelegatedArtifactRead('parent-child', 'session://investigation/unrelated.json')).toThrow();
      expect(() => assertDelegatedArtifactWrite('parent-child', output)).toThrow();
    } finally {
      releaseNested();
      releaseParent();
    }
  });
  it('does not publish partial grants when an input cannot be read', () => {
    const read = vi.fn(() => {
      throw new Error('hash mismatch');
    }) as unknown as SessionArtifactResolver['read'];
    expect(() => grantDelegatedArtifactAccess('child', 'root', [uri], { read })).toThrow(/hash/);
    expect(resolveDelegatedArtifactRead('child', uri).sessionId).toBe('child');
  });
  it('reads granted material by URI alone, refuses a copied hash and refuses material changed after the grant', () => {
    const { resolver } = createInvestigationHarness();
    const granted = resolver.write(SESSION_ID, 'session://tool-outputs/review-input.json', '{"reading":1}', {
      mimeType: 'application/json',
    });
    const release = grantDelegatedArtifactAccess('reviewer', SESSION_ID, [granted.uri], resolver);
    try {
      expect(() => assertGrantBindsVersion('reviewer', granted.hash)).toThrow(/ARTIFACT_SESSION_DENIED/);
      expect(() => assertGrantBindsVersion(SESSION_ID, granted.hash)).not.toThrow();
      const scope = resolveDelegatedArtifactRead('reviewer', granted.uri);
      expect(resolver.read(scope.sessionId, granted.uri, { expectedHash: scope.expectedHash }).text).toBe(
        '{"reading":1}',
      );
      resolver.write(SESSION_ID, granted.uri, '{"reading":2}', { mimeType: 'application/json' });
      expect(() => resolver.read(scope.sessionId, granted.uri, { expectedHash: scope.expectedHash })).toThrow(
        /ARTIFACT_HASH_MISMATCH/,
      );
    } finally {
      release();
    }
  });
});
