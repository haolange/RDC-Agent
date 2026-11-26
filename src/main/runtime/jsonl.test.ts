import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  appendJsonl,
  assertNoJsonlDiagnostics,
  onJsonlTailRepair,
  readJsonl,
  writeJsonl,
  type JsonlTailRepair,
} from './jsonl';

const IdRecord = z.object({ id: z.number() });
const NumberRecord = z.object({ n: z.number() });
const ValueRecord = z.object({ id: z.number(), value: z.string() });

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

    const result = readJsonl(filePath, IdRecord.parse);
    expect(result.records).toEqual([{ id: 1 }, { id: 3 }]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.line).toBe(2);
    expect(() => assertNoJsonlDiagnostics(filePath, result.diagnostics)).toThrow(/JSONL corruption/);
  });

  it('throws on file-level read errors instead of returning an empty array', () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-jsonl-'));
    const filePath = path.join(root, 'dir-as-file');
    fs.mkdirSync(filePath);

    expect(() => readJsonl(filePath, IdRecord.parse)).toThrow(/Failed to read JSONL file/);
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
    const result = readJsonl(filePath, NumberRecord.parse);
    expect(result.diagnostics).toEqual([]);
    expect(result.records.map((entry) => entry.n)).toEqual([1, 2, 3]);
  });

  it('sets an interrupted append aside byte for byte before the next record and reports the repair', () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-jsonl-'));
    const filePath = path.join(root, 'torn.jsonl');
    fs.writeFileSync(filePath, '{"n":1}\n{"n":2,"text":"interru', 'utf8');
    const repairs: JsonlTailRepair[] = [];
    const unsubscribe = onJsonlTailRepair((repair) => repairs.push(repair));
    try {
      appendJsonl(filePath, { n: 3 });
    } finally {
      unsubscribe();
    }

    expect(readJsonl(filePath, NumberRecord.parse)).toEqual({ records: [{ n: 1 }, { n: 3 }], diagnostics: [] });
    expect(repairs).toHaveLength(1);
    expect(repairs[0]).toMatchObject({ code: 'JSONL_TORN_TAIL', filePath, length: 22 });
    expect(fs.readFileSync(repairs[0]!.quarantinePath, 'utf8')).toBe('{"n":2,"text":"interru');
  });

  it('keeps a complete last record that only lacks its newline', () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-jsonl-'));
    const filePath = path.join(root, 'unterminated.jsonl');
    fs.writeFileSync(filePath, '{"n":1}\n{"n":2}', 'utf8');
    expect(readJsonl(filePath, NumberRecord.parse).records.map((entry) => entry.n)).toEqual([1, 2]);
    appendJsonl(filePath, { n: 3 });
    expect(fs.readFileSync(filePath, 'utf8')).toBe('{"n":1}\n{"n":2}\n{"n":3}\n');
    expect(fs.readdirSync(root)).toEqual(['unterminated.jsonl']);
  });

  it('throws from writeJsonl on failure instead of returning false', () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-jsonl-'));
    const blockedDir = path.join(root, 'blocked');
    fs.writeFileSync(blockedDir, 'not-a-directory', 'utf8');
    const filePath = path.join(blockedDir, 'out.jsonl');

    expect(() => writeJsonl(filePath, [{ ok: true }])).toThrow();
  });

  it('selects while scanning, preserves split UTF8 and reports unselected corruption', () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-jsonl-'));
    const filePath = path.join(root, 'chunked.jsonl');
    const large = `${'x'.repeat(65529)}😀汉字`;
    fs.writeFileSync(
      filePath,
      `${JSON.stringify({ id: 1, value: large })}\r\n{broken}\n${JSON.stringify({ id: 3, value: '终😀' })}`,
      'utf8',
    );
    const seen: number[] = [];
    const result = readJsonl(filePath, ValueRecord.parse, (record) => {
      seen.push(record.id);
      if (record.id === 1) expect(record.value).toBe(large);
      return record.id === 3;
    });
    expect(seen).toEqual([1, 3]);
    expect(result.records).toEqual([{ id: 3, value: '终😀' }]);
    expect(result.diagnostics).toMatchObject([{ line: 2 }]);
    expect(() => assertNoJsonlDiagnostics(filePath, result.diagnostics)).toThrow(/JSONL corruption/);
  });

  it('does not swallow a domain validation rejection in the selector', () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-jsonl-'));
    const filePath = path.join(root, 'invalid-schema.jsonl');
    fs.writeFileSync(filePath, '{"schemaVersion":1}\n');
    expect(() =>
      readJsonl(
        filePath,
        (value) => value,
        () => {
          throw new Error('invalid context entry');
        },
      ),
    ).toThrow('invalid context entry');
  });

  it('reports a JSON line that is not a valid record as corruption, never as a record', () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-jsonl-'));
    const filePath = path.join(root, 'invalid-record.jsonl');
    fs.writeFileSync(filePath, '{"id":1}\n{"id":"two"}\n{"id":3}', 'utf8');
    const result = readJsonl(filePath, IdRecord.parse);
    expect(result.records).toEqual([{ id: 1 }, { id: 3 }]);
    expect(result.diagnostics).toMatchObject([{ line: 2 }]);
    expect(() => assertNoJsonlDiagnostics(filePath, result.diagnostics)).toThrow(
      expect.objectContaining({ code: 'STORAGE_CORRUPT' }),
    );
  });
});
