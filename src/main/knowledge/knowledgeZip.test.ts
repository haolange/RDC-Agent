import { describe, expect, it } from 'vitest';
import {
  KNOWLEDGE_PACKAGE_MANIFEST,
  KNOWLEDGE_PACKAGE_ZIP_MAX_UNCOMPRESSED,
  isZipBuffer,
  normalizeZipEntryName,
  pickKnowledgeYamlEntry,
  unzipKnowledgeFiles,
  utf8FromZip,
  utf8ToZip,
  zipKnowledgeFiles,
} from './knowledgeZip';

describe('knowledgeZip', () => {
  it('round-trips yaml and an image under safe relative names', () => {
    const packed = zipKnowledgeFiles([
      { name: KNOWLEDGE_PACKAGE_MANIFEST, data: utf8ToZip('schema: rdc.knowledge-package/1\n') },
      { name: 'cases/aird-1/observed.png', data: new Uint8Array([1, 2, 3]) },
    ]);
    expect(isZipBuffer(packed)).toBe(true);
    const files = unzipKnowledgeFiles(packed);
    expect(utf8FromZip(files.get(KNOWLEDGE_PACKAGE_MANIFEST)!)).toContain('rdc.knowledge-package/1');
    expect([...files.get('cases/aird-1/observed.png')!]).toEqual([1, 2, 3]);
  });

  it('rejects zip-slip and absolute entry names', () => {
    expect(() => normalizeZipEntryName('../secret.png')).toThrow('KNOWLEDGE_ZIP_PATH_INVALID');
    expect(() => normalizeZipEntryName('C:/abs.png')).toThrow('KNOWLEDGE_ZIP_PATH_INVALID');
    expect(() => normalizeZipEntryName('/root/abs.png')).toThrow('KNOWLEDGE_ZIP_PATH_INVALID');
  });

  it('prefers knowledge.yaml then a single root yaml', () => {
    expect(pickKnowledgeYamlEntry(['knowledge.yaml', 'extra.yaml'])).toBe('knowledge.yaml');
    expect(pickKnowledgeYamlEntry(['case.yml'])).toBe('case.yml');
    expect(pickKnowledgeYamlEntry(['a.yaml', 'b.yaml'])).toBeNull();
    expect(pickKnowledgeYamlEntry(['nested/case.yaml'])).toBeNull();
  });

  it('fails closed when uncompressed bytes exceed the package cap', () => {
    const tooBig = new Uint8Array(KNOWLEDGE_PACKAGE_ZIP_MAX_UNCOMPRESSED + 1);
    expect(() => zipKnowledgeFiles([{ name: 'overflow.bin', data: tooBig }])).toThrow('KNOWLEDGE_ZIP_TOO_LARGE');
  });
});
