import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { SessionArtifactResolver } from '../../sessions/SessionArtifactResolver';
import { resetSessionArtifactQuotaLedger } from '../../sessions/SessionArtifactQuota';
import { assertDelegatedArtifactWrite, grantDelegatedArtifactAccess, resolveDelegatedArtifactRead } from '../../sessions/DelegatedArtifactAccess';
import { artifactizeToolResult } from './ToolResultArtifactizer';
import { storeToolImage } from './ToolImageArtifact';

const roots: string[] = [];
afterEach(() => {
  resetSessionArtifactQuotaLedger();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
const pixels = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082', 'hex');
function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-image-reuse-')); roots.push(root);
  const sessions = new Map(['one', 'two'].map(id => {
    const dir = path.join(root, id); fs.mkdirSync(dir); return [id, dir];
  }));
  const resolver = new SessionArtifactResolver({ resolveSessionPath: id => sessions.get(id) ?? null });
  return { root, resolver, sessions };
}
function offload(resolver: SessionArtifactResolver, call: string, sessionId = 'one') {
  return artifactizeToolResult({ sessionId, toolCallId: call, toolName: 'read_image', resolver, thresholdBytes: 1,
    result: { content: [{ type: 'text', text: `Observed in ${call}` }, { type: 'image', mimeType: 'image/png', data: pixels.toString('base64') }] } });
}
function manifest(resolver: SessionArtifactResolver, uri: string) {
  const read = resolver.read('one', uri);
  return JSON.parse(JSON.parse(read.text!).chunks.join(''));
}

describe('tool image reuse', () => {
  it('keeps independent call provenance and model pixels while charging one image payload', () => {
    const { resolver } = setup();
    const first = offload(resolver, 'first'); const second = offload(resolver, 'second');
    expect(first.isError).not.toBe(true); expect(second.isError).not.toBe(true);
    expect(second.content).toContainEqual({ type: 'image', mimeType: 'image/png', data: pixels.toString('base64') });
    const a = manifest(resolver, 'session://tool-outputs/first.json');
    const b = manifest(resolver, 'session://tool-outputs/second.json');
    expect(a.source.toolCallId).toBe('first'); expect(b.source.toolCallId).toBe('second');
    expect(b.content[1]).toEqual(a.content[1]);
    const files = resolver.list('one', 'tool-outputs');
    expect(files.filter(uri => uri.endsWith('.png'))).toHaveLength(1);
    expect(resolver.getQuotaUsage('one').diskBytes).toBe(files.reduce((sum, uri) => sum + fs.statSync(resolver.resolve('one', uri).absolutePath).size, 0));
  });

  it('reuses historical exact pixels without rewriting or deleting their URI', () => {
    const { resolver } = setup();
    const old = resolver.write('one', 'session://tool-outputs/old-call-image-1.png', pixels, { mimeType: 'image/png' });
    const before = fs.statSync(resolver.resolve('one', old.uri).absolutePath).mtimeMs;
    expect(offload(resolver, 'later').isError).not.toBe(true);
    expect(manifest(resolver, 'session://tool-outputs/later.json').content[1]).toMatchObject({ ref: old.uri, hash: old.hash });
    expect(resolver.read('one', old.uri, { expectedHash: old.hash, includeImageData: true }).imageData).toBe(pixels.toString('base64'));
    expect(fs.statSync(resolver.resolve('one', old.uri).absolutePath).mtimeMs).toBe(before);
    expect(resolver.list('one', 'tool-outputs').filter(uri => uri.endsWith('.png'))).toEqual([old.uri]);
  });

  it('never deletes a reused historical image when a new call manifest exceeds quota', () => {
    const { resolver, sessions } = setup();
    const old = resolver.write('one', 'session://tool-outputs/old-image.png', pixels, { mimeType: 'image/png' });
    const constrained = new SessionArtifactResolver({ resolveSessionPath: id => sessions.get(id) ?? null, maxSessionBytes: pixels.length + 10 });
    expect(offload(constrained, 'cannot-fit').isError).toBe(true);
    expect(constrained.list('one', 'tool-outputs')).toEqual([old.uri]);
    expect(constrained.read('one', old.uri, { expectedHash: old.hash }).hash).toBe(old.hash);
  });

  it('rejects corrupted content-addressed files rather than overwriting or trusting their name', () => {
    const { resolver } = setup();
    const hash = crypto.createHash('sha256').update(pixels).digest('hex');
    const uri = `session://tool-outputs/image-${hash}.png`;
    const different = Buffer.concat([pixels, Buffer.from('different')]);
    resolver.write('one', uri, different, { mimeType: 'image/png' });
    expect(offload(resolver, 'corrupt').details).toMatchObject({ code: 'ARTIFACT_HASH_MISMATCH', artifactized: false });
    expect(fs.readFileSync(resolver.resolve('one', uri).absolutePath)).toEqual(different);
  });

  it('retains hardlink rejection even when linked bytes equal the requested image', () => {
    const { resolver, sessions } = setup();
    const source = resolver.write('two', 'session://tool-outputs/source.png', pixels, { mimeType: 'image/png' });
    const hash = crypto.createHash('sha256').update(pixels).digest('hex');
    const planted = path.join(sessions.get('one')!, 'session-artifacts', 'tool-outputs', `image-${hash}.png`);
    fs.mkdirSync(path.dirname(planted), { recursive: true });
    fs.linkSync(resolver.resolve('two', source.uri).absolutePath, planted);
    expect(offload(resolver, 'linked').details).toMatchObject({ code: 'ARTIFACT_HARDLINK_REJECTED', artifactized: false });
    expect(fs.readFileSync(planted)).toEqual(pixels);
    expect(fs.readFileSync(resolver.resolve('two', source.uri).absolutePath)).toEqual(pixels);
  });

  it('does not merge different bytes, sessions, or delegated execution ownership', () => {
    const { resolver } = setup();
    const parent = storeToolImage(resolver, 'one', '', 'png', 'image/png', pixels);
    const different = storeToolImage(resolver, 'one', '', 'png', 'image/png', Buffer.concat([pixels, Buffer.from('different')]));
    const other = storeToolImage(resolver, 'two', '', 'png', 'image/png', pixels);
    expect(different.uri).not.toBe(parent.uri); expect(other.created).toBe(true);
    const release = grantDelegatedArtifactAccess('review-one', 'one', [], resolver);
    try {
      expect(offload(resolver, 'child-first', 'review-one').isError).not.toBe(true);
      expect(offload(resolver, 'child-second', 'review-one').isError).not.toBe(true);
      const child = manifest(resolver, resolver.list('one', 'tool-outputs').find(uri => uri.endsWith('child-second.json'))!);
      const ref = child.content[1];
      expect(ref.ref).not.toBe(parent.uri);
      expect(resolveDelegatedArtifactRead('review-one', ref.ref, ref.hash).sessionId).toBe('one');
      expect(() => resolveDelegatedArtifactRead('review-one', parent.uri, parent.hash)).toThrow('ARTIFACT_SESSION_DENIED');
      expect(() => assertDelegatedArtifactWrite('review-one', parent.uri)).toThrow('ARTIFACT_SESSION_DENIED');
      expect(resolver.list('one', 'tool-outputs').filter(uri => uri.endsWith('.png'))).toHaveLength(3);
    } finally { release(); }
  });
});
