import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { TOOL_RESULT_ARTIFACTIZE_THRESHOLD_BYTES } from '@shared/types/sessionArtifact';
import { SessionArtifactResolver } from '../../sessions/SessionArtifactResolver';
import { resetSessionArtifactQuotaLedger } from '../../sessions/SessionArtifactQuota';
import { StorageIo } from '../../sessions/StorageIo';
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
    expect(stored).toContain(huge);
    expect(JSON.stringify(result.content).length).toBeLessThan(huge.length);
    const envelope = JSON.parse(stored) as {
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
    expect(String((result.details as { hash: string }).hash)).toBe(envelope.hash);
    expect((result.details as { bytes: number }).bytes).toBe(envelope.size);
    const read = resolverFor(sessionPath).read('sess-1', 'session://tool-outputs/tc-big.json');
    expect(read.owner).toBe('sess-1');
    expect(read.source).toEqual({ toolName: 'grep', toolCallId: 'tc-big' });
    expect(read.hash).toBe(envelope.hash);
    expect(read.hash).not.toBe(envelopeFileHash);
    expect(read.bytes).toBe(envelope.size);
    expect(read.mimeType).toBe(envelope.mime);
    expect(read.bytes).not.toBe(Buffer.byteLength(stored, 'utf8'));
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
});
