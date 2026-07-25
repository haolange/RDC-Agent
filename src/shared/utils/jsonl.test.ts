import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  appendJsonl,
  assertNoJsonlDiagnostics,
  readJsonl,
  writeJsonl,
} from './jsonl';

describe('jsonl fault handling', () => {
  let root = '';

  afterEach(() => {
    if (root && fs.existsSync(root)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('reports corrupted middle lines in diagnostics instead of silently skipping', () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-jsonl-'));
    const filePath = path.join(root, 'records.jsonl');
    fs.writeFileSync(filePath, '{"id":1}\n{bad-json}\n{"id":3}\n', 'utf8');

    const result = readJsonl<{ id: number }>(filePath);
    expect(result.records).toEqual([{ id: 1 }, { id: 3 }]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.line).toBe(2);
    expect(() => assertNoJsonlDiagnostics(filePath, result.diagnostics)).toThrow(/JSONL corruption/);
  });

  it('throws on file-level read errors instead of returning an empty array', () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-jsonl-'));
    const filePath = path.join(root, 'dir-as-file');
    fs.mkdirSync(filePath);

    expect(() => readJsonl(filePath)).toThrow(/Failed to read JSONL file/);
  });

  it('appends without re-reading the whole file and keeps newline protocol', () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-jsonl-'));
    const filePath = path.join(root, 'append.jsonl');
    writeJsonl(filePath, [{ n: 1 }]);
    appendJsonl(filePath, { n: 2 });
    appendJsonl(filePath, { n: 3 });

    const content = fs.readFileSync(filePath, 'utf8');
    expect(content.endsWith('\n')).toBe(true);
    expect(content.split('\n').filter(Boolean)).toHaveLength(3);
    const result = readJsonl<{ n: number }>(filePath);
    expect(result.diagnostics).toEqual([]);
    expect(result.records.map((entry) => entry.n)).toEqual([1, 2, 3]);
  });

  it('throws from writeJsonl on failure instead of returning false', () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-jsonl-'));
    const blockedDir = path.join(root, 'blocked');
    fs.writeFileSync(blockedDir, 'not-a-directory', 'utf8');
    const filePath = path.join(blockedDir, 'out.jsonl');

    expect(() => writeJsonl(filePath, [{ ok: true }])).toThrow();
  });
});
