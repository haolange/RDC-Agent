/**
 * Storage fault contract — corrupted JSONL surfaces diagnostics (Integrity).
 * Phase 7 matrix entry; complements src/shared/utils/jsonl.test.ts.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  assertNoJsonlDiagnostics,
  readJsonl,
  writeJsonl,
} from '../../runtime/jsonl';
import { StorageIo } from '../../runtime/StorageIo';

const IdRecord = z.object({ id: z.string() });
const NumberRecord = z.object({ n: z.number() });

describe('storageFaultContract: corrupted JSONL', () => {
  let root = '';

  afterEach(() => {
    if (root && fs.existsSync(root)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('keeps valid records and fails closed on assert (failure-class: integrity)', () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-storage-fault-'));
    const filePath = path.join(root, 'conversation.jsonl');
    fs.writeFileSync(filePath, '{"id":"a"}\nNOT_JSON\n{"id":"c"}\n', 'utf8');

    const result = readJsonl(filePath, IdRecord.parse);
    expect(result.records.map((r) => r.id)).toEqual(['a', 'c']);
    expect(result.diagnostics).toHaveLength(1);
    expect(() => assertNoJsonlDiagnostics(filePath, result.diagnostics)).toThrow(/JSONL corruption/);
  });

  it('round-trips clean writes without diagnostics', () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-storage-clean-'));
    const filePath = path.join(root, 'ok.jsonl');
    writeJsonl(filePath, [{ n: 1 }, { n: 2 }]);
    const result = readJsonl(filePath, NumberRecord.parse);
    expect(result.diagnostics).toEqual([]);
    expect(result.records.map((r) => r.n)).toEqual([1, 2]);
  });

  it('treats a missing file as empty with no diagnostics', () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-storage-missing-'));
    const filePath = path.join(root, 'absent.jsonl');
    const result = readJsonl(filePath, IdRecord.parse);
    expect(result.records).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it('reports an interrupted final append as a torn tail and keeps the complete records readable', () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-storage-trunc-'));
    const filePath = path.join(root, 'trunc.jsonl');
    fs.writeFileSync(filePath, '{"id":"ok"}\n{"id":', 'utf8');
    const result = readJsonl(filePath, IdRecord.parse);
    expect(result.records.map((r) => r.id)).toEqual(['ok']);
    expect(result.diagnostics).toEqual([]);
    expect(result.tornTail).toEqual({ offset: 12, length: 6 });
  });
});

describe('storageFaultContract: StorageIo corrupt JSON', () => {
  let root = '';
  const io = new StorageIo();

  afterEach(() => {
    if (root && fs.existsSync(root)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('throws STORAGE_CORRUPT on every read and keeps a copy of unrecoverable JSON (failure-class: integrity)', () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-storage-corrupt-'));
    const filePath = path.join(root, 'session.json');
    fs.writeFileSync(filePath, 'not-json', 'utf8');
    expect(() => io.readJson(filePath)).toThrow(/STORAGE_CORRUPT/);
    expect(() => io.readJson(filePath)).toThrow(/STORAGE_CORRUPT/);
    expect(fs.readFileSync(filePath, 'utf8')).toBe('not-json');
    expect(fs.readdirSync(root).filter((name) => name.startsWith('session.json.corrupt-'))).toHaveLength(1);
  });

  it('deepMerge rejects prototype pollution keys', () => {
    const merged = io.deepMerge(
      { a: 1 } as Record<string, unknown>,
      JSON.parse('{"__proto__":{"polluted":true},"a":2}') as Record<string, unknown>,
    );
    expect(merged).toEqual({ a: 2 });
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });

  it('atomic write survives and leaves no tmp residue', () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-storage-atomic-'));
    const filePath = path.join(root, 'run.json');
    io.writeJsonAtomic(filePath, { status: 'running' });
    expect(io.readJson(filePath)).toEqual({ status: 'running' });
    expect(fs.readdirSync(root).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });
});