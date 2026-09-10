import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { TOOL_RESULT_ARTIFACTIZE_THRESHOLD_BYTES } from '@shared/types/sessionArtifact';
import { SessionArtifactResolver } from '../../sessions/SessionArtifactResolver';
import { resetSessionArtifactQuotaLedger } from '../../sessions/SessionArtifactQuota';
import { StorageIo } from '../../sessions/StorageIo';
import { grantDelegatedArtifactAccess, resolveDelegatedArtifactRead } from '../../sessions/DelegatedArtifactAccess';
import { artifactizeToolResult } from './ToolResultArtifactizer';

const roots: string[] = [];
afterEach(() => {
  resetSessionArtifactQuotaLedger();
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function resolverFor(sessionPath: string): SessionArtifactResolver {
  return new SessionArtifactResolver({
    resolveSessionPath: (sessionId) => (sessionId === 'sess-1' ? sessionPath : null),
    io: new StorageIo(),
  });
}

describe('ToolResultArtifactizer', () => {
  it('leaves results at or below the 32 KiB threshold in place', () => {
    const sessionPath = fs.mkdtempSync(path.join(os.tmpdir(), 'rdx-art-below-'));
    roots.push(sessionPath);
    const small = {
      content: [{ type: 'text' as const, text: 'hello' }],
      details: { path: 'a.txt' },
    };
    const result = artifactizeToolResult({
      sessionId: 'sess-1',
      toolCallId: 'tc-small',
      toolName: 'read_file',
      result: small,
      resolver: resolverFor(sessionPath),
    });
    expect(result).toEqual(small);
    expect(result.details).toMatchObject({ path: 'a.txt' });
    expect(fs.existsSync(path.join(sessionPath, 'session-artifacts'))).toBe(false);
  });

  it('offloads oversized successful results to session://tool-outputs', () => {
    const sessionPath = fs.mkdtempSync(path.join(os.tmpdir(), 'rdx-art-over-'));
    roots.push(sessionPath);
    fs.writeFileSync(path.join(sessionPath, 'session.json'), '{}');
    const huge = 'x'.repeat(TOOL_RESULT_ARTIFACTIZE_THRESHOLD_BYTES + 64);
    const result = artifactizeToolResult({
      sessionId: 'sess-1',
      toolCallId: 'tc-big',
      toolName: 'grep',
      result: {
        content: [{ type: 'text', text: huge }],
        details: { matched: 9 },
      },
      resolver: resolverFor(sessionPath),
    });
    expect(result.isError).not.toBe(true);
    expect(result.details).toMatchObject({
      artifactized: true,
      ref: 'session://tool-outputs/tc-big.json',
      owner: 'sess-1',
      source: { toolName: 'grep', toolCallId: 'tc-big' },
    });
    expect(String((result.details as { hash: string }).hash)).toMatch(/^[a-f0-9]{64}$/);
    const stored = fs.readFileSync(
      path.join(sessionPath, 'session-artifacts', 'tool-outputs', 'tc-big.json'),
      'utf8',
    );
    const reconstructed = (JSON.parse(stored) as { chunks: string[] }).chunks.join('');
    expect(reconstructed).toContain(huge);
    expect(stored.split('\n').every((line) => line.length < 25000)).toBe(true);
    expect(JSON.stringify(result.content).length).toBeLessThan(huge.length);
    const envelope = JSON.parse(reconstructed) as {
      owner: string;
      source: { toolName: string; toolCallId: string };
      hash: string;
      size: number;
      mime: string;
      content: unknown;
    };
    expect(envelope).toMatchObject({
      owner: 'sess-1',
      source: { toolName: 'grep', toolCallId: 'tc-big' },
      mime: 'application/json',
    });
    expect(envelope.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(envelope.size).toBeGreaterThan(TOOL_RESULT_ARTIFACTIZE_THRESHOLD_BYTES);
    const envelopeFileHash = crypto.createHash('sha256').update(stored, 'utf8').digest('hex');
    expect(envelope.hash).not.toBe(envelopeFileHash);
    expect(String((result.details as { hash: string }).hash)).toBe(envelopeFileHash);
    expect((result.details as { bytes: number }).bytes).toBe(envelope.size);
    const read = resolverFor(sessionPath).read('sess-1', 'session://tool-outputs/tc-big.json');
    expect(read.owner).toBeUndefined();
    expect(read.source).toBeUndefined();
    expect(read.hash).toBe(envelopeFileHash);
    expect(read.hash).not.toBe(envelope.hash);
    expect(read.bytes).toBe(Buffer.byteLength(stored));
    expect(read.mimeType).toBe(envelope.mime);
    expect(read.bytes).toBe(Buffer.byteLength(stored, 'utf8'));
  });

  it('fail-closes instead of silently truncating when offload cannot run', () => {
    const huge = 'y'.repeat(TOOL_RESULT_ARTIFACTIZE_THRESHOLD_BYTES + 8);
    const denied = artifactizeToolResult({
      sessionId: null,
      toolCallId: 'tc-nosess',
      toolName: 'shell',
      result: { content: [{ type: 'text', text: huge }] },
    });
    expect(denied.isError).toBe(true);
    expect(JSON.stringify(denied)).toMatch(/ARTIFACT_SESSION_DENIED/);
    expect(JSON.stringify(denied)).not.toContain(huge.slice(0, 80));
  });
  it('stores large child error output under root, grants exact readback and preserves critical tail', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rdx-child-offload-')); roots.push(root);
    fs.writeFileSync(path.join(root, 'session.json'), '{}');
    const resolver = resolverFor(root);
    const release = grantDelegatedArtifactAccess('child-one', 'sess-1', [], resolver);
    try {
      const original = { isError: true, content: [{ type: 'text' as const, text: 'z'.repeat(100000) + 'CRITICAL: same driver only; recheck on change' }] };
      const output = artifactizeToolResult({ sessionId: 'child-one', toolCallId: 'same-call', toolName: 'grep', result: original, resolver });
      expect(output.isError).toBe(true);
      const details = output.details as { ref: string; hash: string };
      const scope = resolveDelegatedArtifactRead('child-one', details.ref, details.hash);
      expect(scope.sessionId).toBe('sess-1');
      let lines: string[] = [];
      for (let offset = 1; ; offset += 2) {
        const page = resolver.read(scope.sessionId, details.ref, { expectedHash: details.hash, offset, limit: 2 });
        lines = [...lines, page.text!]; if (!page.truncated) break;
      }
      const envelope = JSON.parse(JSON.parse(lines.join('\n')).chunks.join(''));
      expect(envelope.content).toEqual(original.content);
      expect(details.ref).not.toBe('session://tool-outputs/same-call.json');
    } finally { release(); }
  });
  it('keeps explicit artifact vision content through result artifactization', () => {
    const visual = { content: [{ type: 'text' as const, text: 'session://tool-outputs/diff.png sha256=verified ROI=whole-frame' }, { type: 'image' as const, data: 'a'.repeat(50000), mimeType: 'image/png' }] };
    expect(artifactizeToolResult({ sessionId: 'sess-1', toolCallId: 'visual', toolName: 'artifact_read', result: visual })).toBe(visual);
  });

});
