import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SessionArtifactResolver } from './SessionArtifactResolver';
import { resetSessionArtifactQuotaLedger } from './SessionArtifactQuota';
import { StorageIo } from './StorageIo';

const roots: string[] = [];
afterEach(() => {
  resetSessionArtifactQuotaLedger();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-artifact-text-'));
  roots.push(root);
  const resolver = new SessionArtifactResolver({ resolveSessionPath: (id) => id === 'owner' ? root : null, io: new StorageIo() });
  const uri = 'session://tool-outputs/source.json';
  const write = (text: string) => {
    const content = JSON.stringify({ content: [{ type: 'text', text: JSON.stringify({ source: text }) }] });
    return resolver.write('owner', uri, JSON.stringify({ encoding: 'json-chunks', chunks: [content.slice(0, 17), content.slice(17)] }));
  };
  return { resolver, uri, write, pointers: ['/content/0/text'] };
}

describe('hash-bound artifact text views and searches', () => {
  it('searches the complete decoded string, distinguishes hashes, and treats regex syntax literally', () => {
    const { resolver, uri, write, pointers } = fixture();
    const source = 'prefix a.*b\n' + 'unrelated text\n'.repeat(4000) + 'suffix a.*b\n';
    const saved = write(source);
    const result = resolver.read('owner', uri, { expectedHash: saved.hash, jsonTextPointers: pointers, textPointer: '/source', search: 'a.*b' });
    expect(result.hash).toBe(saved.hash);
    expect(result.textView).toMatchObject({ pointer: '/source', sha256: sha(source), bytes: Buffer.byteLength(source) });
    expect(result.textView?.layers.map((layer) => layer.kind)).toEqual(['file', 'json-chunks', 'json-text', 'json-string']);
    expect(result.search).toMatchObject({ query: 'a.*b', totalMatches: 2, returnedMatches: 2 });
    const body = JSON.parse(result.text!);
    expect(body.matches.map((match: { line: number }) => match.line)).toEqual([1, 4002]);
    expect(result.truncated).toBe(false);
    expect(result.next).toBeUndefined();
    expect(resolver.read('owner', uri, { expectedHash: saved.hash }).text).not.toBe(source);
  });

  it('reconstructs exact decoded UTF-8 including CRLF with bounded Unicode-safe cursors', () => {
    const { resolver, uri, write, pointers } = fixture();
    const source = '汉😀abc\r\n' + '界😀'.repeat(30) + '\r\nend';
    const saved = write(source);
    let cursor = { offset: 1, column: 0 };
    let reconstructed = '';
    for (let count = 0; count < 100; count++) {
      const result = resolver.read('owner', uri, { expectedHash: saved.hash, jsonTextPointers: pointers, textPointer: '/source', maxBytes: 11, ...cursor });
      expect(Buffer.byteLength(result.text!)).toBeLessThanOrEqual(11);
      reconstructed += result.text;
      if (!result.next) break;
      expect(result.next).not.toEqual(cursor);
      cursor = result.next;
    }
    expect(reconstructed).toBe(source);
    expect(sha(reconstructed)).toBe(sha(source));
  });

  it('reports exhaustive match counts with bounded pages and no repeated or lost matches', () => {
    const { resolver, uri, write, pointers } = fixture();
    const source = '汉😀 needle '.repeat(1000);
    const saved = write(source);
    let cursor = { offset: 1, column: 0 };
    const positions: number[] = [];
    for (let count = 0; count < 1000; count++) {
      const result = resolver.read('owner', uri, { expectedHash: saved.hash, jsonTextPointers: pointers, textPointer: '/source', search: 'needle', limit: 20, maxBytes: 1024, ...cursor });
      expect(result.search?.totalMatches).toBe(1000);
      expect(Buffer.byteLength(result.text!)).toBeLessThanOrEqual(1024);
      positions.push(...JSON.parse(result.text!).matches.map((match: { column: number }) => match.column));
      if (!result.next) break;
      expect(result.next).not.toEqual(cursor);
      cursor = result.next;
    }
    expect(positions).toHaveLength(1000);
    expect(new Set(positions).size).toBe(1000);
    expect(positions[0]).toBe(source.indexOf('needle'));
    expect(positions.at(-1)).toBe(source.lastIndexOf('needle'));
  });

  it('keeps owner/hash/MIME/pointer validation ahead of derived access', () => {
    const { resolver, uri, write, pointers } = fixture();
    const saved = write('text');
    expect(() => resolver.read('other', uri, { expectedHash: saved.hash, search: 'text' })).toThrow('ARTIFACT_SESSION_DENIED');
    expect(() => resolver.read('owner', uri, { search: 'text' })).toThrow('ARTIFACT_HASH_REQUIRED');
    expect(() => resolver.read('owner', uri, { textPointer: '/source' })).toThrow('ARTIFACT_HASH_REQUIRED');
    expect(() => resolver.read('owner', uri, { expectedHash: '0'.repeat(64), search: 'text' })).toThrow('ARTIFACT_HASH_MISMATCH');
    for (const pointer of ['/constructor', '/missing']) {
      expect(() => resolver.read('owner', uri, { expectedHash: saved.hash, jsonTextPointers: pointers, textPointer: pointer })).toThrow('ARTIFACT_JSON_POINTER_INVALID');
    }
    const plain = resolver.write('owner', 'session://tool-outputs/plain.txt', 'safe');
    expect(() => resolver.read('owner', plain.uri, { expectedHash: plain.hash, textPointer: '' })).toThrow('ARTIFACT_MIME_DENIED');
  });

  it('retains genuine zero matches, rejects invalid queries and never evaluates selected text', () => {
    const { resolver, uri, write, pointers } = fixture();
    const source = 'throw new Error("data only");\n';
    const saved = write(source);
    const result = resolver.read('owner', uri, { expectedHash: saved.hash, jsonTextPointers: pointers, textPointer: '/source', search: 'absent' });
    expect(result.search).toMatchObject({ totalMatches: 0, returnedMatches: 0 });
    expect(result.truncated).toBe(false);
    expect(result.next).toBeUndefined();
    for (const search of ['', '\n', 'x'.repeat(257)]) {
      expect(() => resolver.read('owner', uri, { expectedHash: saved.hash, search })).toThrow('ARTIFACT_URI_INVALID');
    }
    expect(resolver.read('owner', uri, { expectedHash: saved.hash, jsonTextPointers: pointers, textPointer: '/source' }).text).toBe(source);
  });

  it('searches ordinary text and preserves explicit producer truncation for decoded data', () => {
    const { resolver } = fixture();
    const plain = resolver.write('owner', 'session://tool-outputs/log.txt', 'needle\r\nNEEDLE\r\nneedle');
    const found = resolver.read('owner', plain.uri, { expectedHash: plain.hash, search: 'needle' });
    expect(found.search?.totalMatches).toBe(2);
    expect(found.textView).toBeUndefined();
    expect(() => resolver.read('owner', plain.uri, { expectedHash: plain.hash, search: 'needle', maxBytes: 4 })).toThrow('ARTIFACT_URI_INVALID');
    const truncated = resolver.write('owner', 'session://tool-outputs/truncated.json', JSON.stringify({ owner: 'owner', source: { toolName: 'test', toolCallId: 'source' }, hash: 'f'.repeat(64), size: 16, mime: 'application/json', content: [], details: { truncated: true }, payloadText: 'recorded excerpt' }));
    const view = resolver.read('owner', truncated.uri, { expectedHash: truncated.hash, textPointer: '/payloadText' });
    expect(view.textView?.sourceResultTruncated).toBe(true);
    const imageEnvelope = resolver.write('owner', 'session://tool-outputs/image.json', JSON.stringify({ owner: 'owner', source: { toolName: 'test', toolCallId: 'image' }, hash: 'a'.repeat(64), size: 0, mime: 'image/png', content: [], details: {}, caption: 'data' }));
    expect(() => resolver.read('owner', imageEnvelope.uri, { expectedHash: imageEnvelope.hash, textPointer: '/caption' })).toThrow('ARTIFACT_MIME_DENIED');
    expect(() => resolver.read('owner', imageEnvelope.uri, { expectedHash: imageEnvelope.hash, search: 'data' })).toThrow('ARTIFACT_MIME_DENIED');
    const malformed = resolver.write('owner', 'session://tool-outputs/unicode.json', JSON.stringify({ text: '\ud800' }));
    expect(() => resolver.read('owner', malformed.uri, { expectedHash: malformed.hash, textPointer: '/text' })).toThrow('ARTIFACT_JSON_INVALID');
  });
});
