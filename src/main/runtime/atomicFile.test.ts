import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseJsonWith, readValidatedSync, writeFileAtomic, writeFileAtomicSync } from './atomicFile';

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-atomic-'));
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

const parseCount = parseJsonWith((value) => {
  if (typeof (value as { count?: unknown }).count !== 'number') throw new Error('count must be a number');
  return value as { count: number };
});

describe('atomic file writes', () => {
  it('replaces the target in place and leaves no temporary file', async () => {
    const target = path.join(root, 'nested', 'state.json');
    writeFileAtomicSync(target, '{"count":1}');
    await writeFileAtomic(target, '{"count":2}');
    expect(fs.readFileSync(target, 'utf8')).toBe('{"count":2}');
    expect(fs.readdirSync(path.dirname(target))).toEqual(['state.json']);
  });

  it('removes its temporary file when the rename fails', () => {
    const target = path.join(root, 'occupied');
    fs.mkdirSync(path.join(target, 'child'), { recursive: true });
    expect(() => writeFileAtomicSync(target, 'x')).toThrow();
    expect(fs.readdirSync(root)).toEqual(['occupied']);
  });
});

describe('validated reads', () => {
  it('reads a missing file as null and a valid one as its value', () => {
    const target = path.join(root, 'state.json');
    expect(readValidatedSync(target, parseCount)).toBeNull();
    writeFileAtomicSync(target, '{"count":3}');
    expect(readValidatedSync(target, parseCount)).toEqual({ count: 3 });
  });

  it('reports a damaged file on every read, keeps one copy, and never reads it as empty', () => {
    const target = path.join(root, 'state.json');
    fs.writeFileSync(target, '{"count":');
    for (let read = 0; read < 2; read += 1) {
      expect(() => readValidatedSync(target, parseCount)).toThrow(
        expect.objectContaining({ code: 'STORAGE_CORRUPT', filePath: target }),
      );
    }
    const copies = fs.readdirSync(root).filter((name) => name.startsWith('state.json.corrupt-'));
    expect(copies).toHaveLength(1);
    expect(fs.readFileSync(path.join(root, copies[0]!), 'utf8')).toBe('{"count":');
    expect(fs.readFileSync(target, 'utf8')).toBe('{"count":');
  });
});
