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

function pngWithTextBytes(count: number): Buffer {
  const png = Buffer.from(
    '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082',
    'hex',
  );
  const type = Buffer.from('tEXt');
  const body = Buffer.concat([Buffer.from('note\0'), Buffer.alloc(count, 0x61)]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(body.length);
  let crc = 0xffffffff;
  for (const byte of Buffer.concat([type, body])) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([png.subarray(0, 33), length, type, body, checksum, png.subarray(33)]);
}

describe('ToolResultArtifactizer', () => {
  it('leaves results at or below the 32 KiB threshold in place', () => {
    const sessionPath = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-art-below-'));
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

  it('pins a small native result without hiding its inline data', () => {
    const sessionPath = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-art-pin-'));
    roots.push(sessionPath);
    fs.writeFileSync(path.join(sessionPath, 'session.json'), '{}');
    const resolver = resolverFor(sessionPath);
    const original = {
      content: [{ type: 'text' as const, text: '{"pixel":0.25}' }],
      details: { operation: 'rd.texture.get_region_values', exitCode: 0 },
    };
    const result = artifactizeToolResult({
      sessionId: 'sess-1', toolCallId: 'tc-native', toolName: 'shell',
      result: original, resolver, pinBelowThreshold: true,
    });
    expect(result.content[0]).toEqual(original.content[0]);
    const pinned = (result.details as { evidenceArtifact: { ref: string; hash: string } }).evidenceArtifact;
    expect(pinned.ref).toBe('session://tool-outputs/tc-native.json');
    expect(pinned).toMatchObject({ owner: 'sess-1', ownerScope: 'product-session' });
    expect(result.content[1]).toEqual({ type: 'text', text: `Evidence ref: ${pinned.ref}\nhash: ${pinned.hash}` });
    const read = resolver.read('sess-1', pinned.ref, { expectedHash: pinned.hash });
    const stored = JSON.parse(fs.readFileSync(path.join(sessionPath, 'session-artifacts', 'tool-outputs', 'tc-native.json'), 'utf8')) as { chunks: string[] };
    expect(JSON.parse(stored.chunks.join('')).content).toEqual(original.content);
    expect(read.hash).toBe(pinned.hash);
  });

  it.each([0, 7])('preserves interpreter source and actual output for granted review (exit %s)', (exitCode) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-interpreter-evidence-')); roots.push(root);
    fs.writeFileSync(path.join(root, 'session.json'), '{}');
    const resolver = resolverFor(root);
    const code = 'print("original source")\n';
    const original = { isError: exitCode !== 0,
      content: [{ type: 'text' as const, text: 'unabridged actual output\n' }],
      details: { exitCode, exitReason: 'exit', truncated: false,
        invocation: { kind: 'configured-local-interpreter-execution', language: 'python', code,
          codeSha256: crypto.createHash('sha256').update(code).digest('hex'), argsPrefix: [] } } };
    const pinned = artifactizeToolResult({ sessionId: 'sess-1', toolCallId: 'cpu-call',
      toolName: 'code_interpreter', result: original, resolver, pinBelowThreshold: true });
    expect(pinned.isError).toBe(exitCode !== 0);
    const ref = (pinned.details as { evidenceArtifact: { ref: string; hash: string } }).evidenceArtifact;
    const release = grantDelegatedArtifactAccess('cpu-review', 'sess-1', [ref.ref], resolver);
    try {
      const grant = resolveDelegatedArtifactRead('cpu-review', ref.ref, ref.hash);
      const read = resolver.read(grant.sessionId, ref.ref, { expectedHash: grant.expectedHash });
      const envelope = JSON.parse(JSON.parse(read.text!).chunks.join(''));
      expect(envelope.source).toEqual({ toolName: 'code_interpreter', toolCallId: 'cpu-call' });
      expect(envelope.content).toEqual(original.content);
      expect(envelope.details).toEqual(original.details);
      expect(() => resolveDelegatedArtifactRead('cpu-review', ref.ref, '0'.repeat(64))).toThrow('ARTIFACT_SESSION_DENIED');
      expect(() => resolveDelegatedArtifactRead('cpu-review', 'session://tool-outputs/ungranted.json')).toThrow('ARTIFACT_SESSION_DENIED');
    } finally { release(); }
  });

  it('keeps the actual cleanup result when pinning fails at the file quota', () => {
    const sessionPath = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-art-cleanup-quota-'));
    roots.push(sessionPath);
    fs.writeFileSync(path.join(sessionPath, 'session.json'), '{}');
    const resolver = new SessionArtifactResolver({ resolveSessionPath: () => sessionPath, maxToolOutputFiles: 1 });
    const old = resolver.write('sess-1', 'session://tool-outputs/history.json', '{}');
    const original = {
      content: [{ type: 'text' as const, text: JSON.stringify({ result: { ok: true, result_kind: 'rd.debug.finish', data: {} } }) }],
      details: { operation: 'rd.debug.finish', exitCode: 0, receipt: { uri: 'session://investigation/receipts/independent.json', hash: 'a'.repeat(64) } },
    };
    const result = artifactizeToolResult({
      sessionId: 'sess-1', toolCallId: 'cleanup', toolName: 'shell', result: original, resolver, pinBelowThreshold: true,
    });
    expect(result.isError).toBe(true);
    expect(result.content).toContainEqual(original.content[0]);
    expect(result.content[0]).toMatchObject({ text: expect.stringContaining('Tool execution already returned successfully') });
    expect(result.content[0]).toMatchObject({ text: expect.stringContaining('Verify any separately returned execution receipt independently') });
    expect(result.details).toEqual({
      code: 'ARTIFACT_QUOTA_EXCEEDED', artifactized: false,
      executionResult: { isError: false, inline: true, detailsInline: true }, originalDetails: original.details,
    });
    expect(resolver.read('sess-1', old.uri, { expectedHash: old.hash }).hash).toBe(old.hash);
    expect(fs.existsSync(path.join(sessionPath, 'session-artifacts', 'tool-outputs', 'cleanup.json'))).toBe(false);
  });

  it('reports execution and persistence separately without leaking an oversized result', () => {
    const sessionPath = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-art-large-quota-'));
    roots.push(sessionPath);
    fs.writeFileSync(path.join(sessionPath, 'session.json'), '{}');
    const resolver = new SessionArtifactResolver({ resolveSessionPath: () => sessionPath, maxSessionBytes: 10 });
    const original = { isError: true, content: [{ type: 'text' as const, text: 'secret-payload'.repeat(5000) }], details: { receipt: { uri: 'session://investigation/receipts/independent.json', hash: 'a'.repeat(64) } } };
    const result = artifactizeToolResult({ sessionId: 'sess-1', toolCallId: 'large', toolName: 'unknown', result: original, resolver });
    expect(result.isError).toBe(true);
    expect(result.details).toMatchObject({ code: 'ARTIFACT_QUOTA_EXCEEDED', executionResult: { isError: true, inline: false, detailsInline: true }, originalDetails: original.details });
    expect(JSON.stringify(result)).not.toContain('secret-payload');
    expect(JSON.stringify(result).length).toBeLessThan(2000);
    expect(result.content[0]).toMatchObject({ text: expect.stringContaining('already returned an error') });
  });

  it('explicitly omits oversized metadata as well as oversized output on persistence failure', () => {
    const sessionPath = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-art-details-quota-'));
    roots.push(sessionPath);
    fs.writeFileSync(path.join(sessionPath, 'session.json'), '{}');
    const resolver = new SessionArtifactResolver({ resolveSessionPath: () => sessionPath, maxSessionBytes: 10 });
    const result = artifactizeToolResult({ sessionId: 'sess-1', toolCallId: 'large-details', toolName: 'unknown', resolver,
      result: { content: [{ type: 'text', text: 'x'.repeat(40000) }], details: { large: 'unbounded-metadata'.repeat(3000) } } });
    expect(result.details).toMatchObject({ executionResult: { isError: false, inline: false, detailsInline: false } });
    expect(result.details).not.toHaveProperty('originalDetails');
    expect(JSON.stringify(result)).not.toContain('unbounded-metadata');
    expect(JSON.stringify(result).length).toBeLessThan(2000);
  });

  it('offloads oversized successful results to session://tool-outputs', () => {
    const sessionPath = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-art-over-'));
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
      ownerScope: 'product-session',
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
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-child-offload-')); roots.push(root);
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

  it.each(['read_image', 'code_interpreter'])('preserves oversized %s image blocks for the model while offloading the full result', (toolName) => {
    const sessionPath = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-art-vision-'));
    roots.push(sessionPath);
    fs.writeFileSync(path.join(sessionPath, 'session.json'), '{}');
    const resolver = resolverFor(sessionPath);
    const image = { type: 'image' as const, data: pngWithTextBytes(40000).toString('base64'), mimeType: 'image/png' };
    const result = artifactizeToolResult({
      sessionId: 'sess-1', toolCallId: `vision-${toolName}`, toolName,
      result: { content: [{ type: 'text', text: 'Viewed current image' }, image] },
      resolver,
    });
    expect(result.isError).not.toBe(true);
    expect(result.content).toContainEqual(image);
    expect(result.details).toMatchObject({ artifactized: true, ref: `session://tool-outputs/vision-${toolName}.json` });
    const stored = JSON.parse(fs.readFileSync(path.join(sessionPath, 'session-artifacts', 'tool-outputs', `vision-${toolName}.json`), 'utf8')) as { chunks: string[] };
    const envelope = JSON.parse(stored.chunks.join('')) as { content: Array<{ ref?: string; hash?: string }> };
    expect(envelope.content[1]).toMatchObject({ ref: `session://tool-outputs/image-${crypto.createHash('sha256').update(Buffer.from(image.data, 'base64')).digest('hex')}.png` });
    const read = resolver.read('sess-1', envelope.content[1].ref!, { expectedHash: envelope.content[1].hash, includeImageData: true });
    expect(read.imageData).toBe(image.data);
    const imageRef = envelope.content[1].ref!;
    const imageHash = envelope.content[1].hash!;
    expect(result.content[0]).toMatchObject({ type: 'text', text: expect.stringContaining(`${imageRef}\nsha256:${imageHash}`) });
    const releaseWrapper = grantDelegatedArtifactAccess('wrapper-reviewer', 'sess-1', [`session://tool-outputs/vision-${toolName}.json`], resolver);
    try {
      expect(() => resolveDelegatedArtifactRead('wrapper-reviewer', imageRef, imageHash)).toThrow('ARTIFACT_SESSION_DENIED');
    } finally { releaseWrapper(); }
    const releaseImage = grantDelegatedArtifactAccess('image-reviewer', 'sess-1', [imageRef], resolver);
    try {
      const access = resolveDelegatedArtifactRead('image-reviewer', imageRef, imageHash);
      expect(resolver.read(access.sessionId, imageRef, { expectedHash: access.expectedHash, includeImageData: true }).imageData).toBe(image.data);
      expect(() => resolveDelegatedArtifactRead('image-reviewer', imageRef, '0'.repeat(64))).toThrow('ARTIFACT_SESSION_DENIED');
    } finally { releaseImage(); }
  });

  it('keeps a multi-megabyte image resolvable without crossing the JSON artifact cap', () => {
    const sessionPath = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-art-large-image-'));
    roots.push(sessionPath);
    fs.writeFileSync(path.join(sessionPath, 'session.json'), '{}');
    const resolver = resolverFor(sessionPath);
    const image = { type: 'image' as const, data: pngWithTextBytes(2 * 1024 * 1024 + 64).toString('base64'), mimeType: 'image/png' };
    const result = artifactizeToolResult({
      sessionId: 'sess-1', toolCallId: 'large-image', toolName: 'read_image',
      result: { content: [{ type: 'text', text: 'Viewed frame' }, image] }, resolver,
    });
    expect(result.isError).not.toBe(true);
    expect(result.content).toContainEqual(image);
    const manifestPath = path.join(sessionPath, 'session-artifacts', 'tool-outputs', 'large-image.json');
    expect(fs.statSync(manifestPath).size).toBeLessThan(2 * 1024 * 1024);
    const manifest = JSON.parse((JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as { chunks: string[] }).chunks.join('')) as {
      content: Array<{ ref?: string; hash?: string; bytes?: number }>;
    };
    const storedImage = manifest.content[1];
    expect(storedImage).toMatchObject({ ref: `session://tool-outputs/image-${crypto.createHash('sha256').update(Buffer.from(image.data, 'base64')).digest('hex')}.png`, bytes: Buffer.from(image.data, 'base64').length });
    expect(resolver.read('sess-1', storedImage.ref!, { expectedHash: storedImage.hash, includeImageData: true }).imageData).toBe(image.data);
  });

  it('removes its new image when the manifest cannot fit the session quota', () => {
    const sessionPath = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-art-image-rollback-'));
    roots.push(sessionPath);
    fs.writeFileSync(path.join(sessionPath, 'session.json'), '{}');
    const bytes = pngWithTextBytes(40000);
    const resolver = new SessionArtifactResolver({
      resolveSessionPath: (sessionId) => (sessionId === 'sess-1' ? sessionPath : null),
      io: new StorageIo(),
      maxSessionBytes: bytes.length + 100,
    });
    const result = artifactizeToolResult({
      sessionId: 'sess-1', toolCallId: 'quota-image', toolName: 'read_image',
      result: { content: [{ type: 'text', text: 'Viewed frame' }, { type: 'image', data: bytes.toString('base64'), mimeType: 'image/png' }] },
      resolver,
    });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).toContain('ARTIFACT_QUOTA_EXCEEDED');
    expect(fs.existsSync(path.join(sessionPath, 'session-artifacts', 'tool-outputs', 'quota-image-image-1.png'))).toBe(false);
    expect(resolver.list('sess-1', 'tool-outputs')).toEqual([]);
    expect(fs.existsSync(path.join(sessionPath, 'session-artifacts', 'tool-outputs', 'quota-image.json'))).toBe(false);
  });

});

it('does not recursively archive an already bounded artifact page', () => {
  const page = { content: [{ type: 'text' as const, text: 'Page body with exact next cursor' }], details: { next: { offset: 4, column: 1024 } } };
  expect(artifactizeToolResult({ sessionId: 'sess', toolCallId: 'read-page', toolName: 'artifact_read', result: page, thresholdBytes: 1 })).toBe(page);
});
