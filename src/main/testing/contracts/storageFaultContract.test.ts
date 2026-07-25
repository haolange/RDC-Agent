/**
 * Storage fault contract — corrupted JSONL surfaces diagnostics (Integrity).
 * Extends src/shared/utils/jsonl.test.ts coverage as the Phase 7 suite entry.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  assertNoJsonlDiagnostics,
  readJsonl,
  writeJsonl,
} from '@shared/utils/jsonl';

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

    const result = readJsonl<{ id: string }>(filePath);
    expect(result.records.map((r) => r.id)).toEqual(['a', 'c']);
    expect(result.diagnostics).toHaveLength(1);
    expect(() => assertNoJsonlDiagnostics(filePath, result.diagnostics)).toThrow(/JSONL corruption/);
  });

  it('round-trips clean writes without diagnostics', () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-storage-clean-'));
    const filePath = path.join(root, 'ok.jsonl');
    writeJsonl(filePath, [{ n: 1 }, { n: 2 }]);
    const result = readJsonl<{ n: number }>(filePath);
    expect(result.diagnostics).toEqual([]);
    expect(result.records.map((r) => r.n)).toEqual([1, 2]);
  });
});
