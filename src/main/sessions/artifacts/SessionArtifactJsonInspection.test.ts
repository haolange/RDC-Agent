import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { inspectArtifactJson } from './SessionArtifactJsonInspection';

const sha = (text: string | Buffer) => createHash('sha256').update(text).digest('hex');
function envelope(text: string, truncated = false) {
  return { owner: 'session-a', source: { toolName: 'shell', toolCallId: 'calculation' }, hash: 'a'.repeat(64), size: text.length, mime: 'application/json', content: [{ type: 'text', text }], details: { truncated } };
}

describe('controlled artifact JSON inspection', () => {
  it('decodes chunked envelopes and hashes exact nested UTF-8 text without counting transport duplicates', () => {
    const inner = '{"values":[[1,2,3],[4,5,6]],"tag":"汉"}';
    const payload = JSON.stringify({ payloadJson: inner, duplicate: inner });
    const encoded = JSON.stringify(envelope(payload));
    const bytes = Buffer.from(JSON.stringify({ encoding: 'json-chunks', chunks: [encoded.slice(0, 20), encoded.slice(20)] }));
    const result = inspectArtifactJson(bytes, ['/content/0/text', '/payloadJson']);
    expect(result.layers).toEqual([
      { kind: 'file', bytes: bytes.length, sha256: sha(bytes) },
      { kind: 'json-chunks', bytes: Buffer.byteLength(encoded), sha256: sha(encoded) },
      { kind: 'json-text', pointer: '/content/0/text', bytes: Buffer.byteLength(payload), sha256: sha(payload) },
      { kind: 'json-text', pointer: '/payloadJson', bytes: Buffer.byteLength(inner), sha256: sha(inner) },
    ]);
    expect(result).toMatchObject({ rootType: 'object', nodeCount: 11, numberCount: 6, nonFiniteNumberCount: 0, arrayCount: 3, arrayLengths: { '2': 1, '3': 2 }, sourceResultTruncated: false });
  });

  it('rejects omitted JSON and retains producer truncation as distinct from successful outer parsing', () => {
    const bytes = Buffer.from(JSON.stringify(envelope('{"values":[1,... [truncated 40 bytes] ...]}', true)));
    expect(inspectArtifactJson(bytes, []).sourceResultTruncated).toBe(true);
    expect(() => inspectArtifactJson(bytes, ['/content/0/text'])).toThrow('ARTIFACT_JSON_INVALID');
  });

  it('supports escaped JSON property names and refuses inherited or non-text selections', () => {
    const bytes = Buffer.from(JSON.stringify({ 'a/b': { '~key': '{"ok":true}' }, value: 3 }));
    expect(inspectArtifactJson(bytes, ['/a~1b/~0key']).rootType).toBe('object');
    for (const pointer of ['/constructor', '/value', '/missing', '/a~2b', 'a/b']) {
      expect(() => inspectArtifactJson(bytes, [pointer])).toThrow('ARTIFACT_JSON_POINTER_INVALID');
    }
  });

  it('fails closed on invalid UTF-8 and malformed chunk envelopes', () => {
    expect(() => inspectArtifactJson(Buffer.from([0xff]), [])).toThrow('ARTIFACT_JSON_INVALID');
    expect(() => inspectArtifactJson(Buffer.from('{"encoding":"json-chunks","chunks":[1]}'), [])).toThrow('ARTIFACT_JSON_INVALID');
  });

  it('reports actual empty data and numeric overflow without substituting successful zero measurements', () => {
    expect(inspectArtifactJson(Buffer.from('[]'), [])).toMatchObject({ arrayCount: 1, arrayLengths: { '0': 1 }, numberCount: 0 });
    expect(inspectArtifactJson(Buffer.from('{"overflow":1e400}'), [])).toMatchObject({ numberCount: 1, nonFiniteNumberCount: 1 });
  });

  it('bounds decoding and traversal without returning a partial success receipt', () => {
    expect(() => inspectArtifactJson(Buffer.from('{}'), Array(5).fill(''))).toThrow('ARTIFACT_JSON_INSPECTION_LIMIT');
    expect(() => inspectArtifactJson(Buffer.from('{}'), ['/'.repeat(257)])).toThrow('ARTIFACT_JSON_POINTER_INVALID');
    expect(() => inspectArtifactJson(Buffer.from(JSON.stringify(Array(100_001).fill(0))), [])).toThrow('ARTIFACT_JSON_INSPECTION_LIMIT');
  });
});
