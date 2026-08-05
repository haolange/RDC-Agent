import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { StorageIo } from './StorageIo';

describe('StorageIo integrity', () => {
  const roots: string[] = [];
  const io = new StorageIo();

  afterEach(() => {
    for (const root of roots.splice(0)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  function tempRoot(): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-storage-io-'));
    roots.push(root);
    return root;
  }

  it('returns null for missing JSON files', () => {
    const root = tempRoot();
    expect(io.readJson(path.join(root, 'missing.json'))).toBeNull();
  });

  it('restores from .bak when primary JSON is corrupt', () => {
    const root = tempRoot();
    const filePath = path.join(root, 'registry.json');
    fs.writeFileSync(filePath, '{not-json', 'utf8');
    fs.writeFileSync(`${filePath}.bak`, JSON.stringify({ ok: true }, null, 2), 'utf8');
    expect(io.readJson<{ ok: boolean }>(filePath)).toEqual({ ok: true });
  });

  it('quarantines corrupt JSON and throws STORAGE_CORRUPT when bak is unavailable', () => {
    const root = tempRoot();
    const filePath = path.join(root, 'broken.json');
    fs.writeFileSync(filePath, '{broken', 'utf8');
    expect(() => io.readJson(filePath)).toThrow(/STORAGE_CORRUPT/);
    expect(fs.existsSync(filePath)).toBe(false);
    const quarantined = fs.readdirSync(root).filter((name) => name.includes('.corrupt.'));
    expect(quarantined.length).toBe(1);
  });

  it('writes JSON atomically and round-trips', () => {
    const root = tempRoot();
    const filePath = path.join(root, 'nested', 'data.json');
    io.writeJsonAtomic(filePath, { a: 1, b: [2] });
    expect(io.readJson(filePath)).toEqual({ a: 1, b: [2] });
    const leftovers = fs.readdirSync(path.dirname(filePath)).filter((name) => name.endsWith('.tmp'));
    expect(leftovers).toEqual([]);
  });

  it('deepMerge skips __proto__, prototype, and constructor keys', () => {
    const base = { safe: 1, nested: { keep: true } } as Record<string, unknown>;
    const patch = JSON.parse('{"safe":2,"__proto__":{"polluted":true},"nested":{"constructor":{"x":1},"ok":3}}') as Record<string, unknown>;
    const merged = io.deepMerge(base, patch);
    expect(merged.safe).toBe(2);
    expect((merged.nested as { ok: number }).ok).toBe(3);
    expect((merged.nested as { keep: boolean }).keep).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(merged, '__proto__')).toBe(false);
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
    expect((merged.nested as { constructor?: unknown }).constructor).toBe(Object.prototype.constructor);
  });
});