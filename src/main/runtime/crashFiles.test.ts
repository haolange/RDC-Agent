import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clearCrashDumps, listCrashDumps, pruneCrashDumps, summarizeCrashFiles } from './crashFiles';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-11-26T12:00:00Z');

describe('crash files', () => {
  let root = '';
  const dump = (relative: string, ageMs: number, bytes = 10) => {
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.alloc(bytes));
    const at = new Date(NOW - ageMs);
    fs.utimesSync(file, at, at);
    return file;
  };

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-crash-files-'));
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('finds the minidumps in every Crashpad folder, newest first, and leaves its bookkeeping alone', () => {
    dump('completed/a.dmp', 3 * DAY, 100);
    dump('pending/b.dmp', DAY, 50);
    dump('new/c.dmp', 2 * DAY, 25);
    fs.writeFileSync(path.join(root, 'settings.dat'), 'crashpad');

    expect(listCrashDumps(root).map((entry) => path.basename(entry.path))).toEqual(['b.dmp', 'c.dmp', 'a.dmp']);
    expect(summarizeCrashFiles(root)).toEqual({ count: 3, bytes: 175 });
    expect(clearCrashDumps(root)).toEqual({ count: 0, bytes: 0 });
    expect(fs.existsSync(path.join(root, 'settings.dat'))).toBe(true);
  });

  it('keeps the five newest minidumps no older than fourteen days at startup', () => {
    for (let index = 0; index < 7; index += 1) dump(`completed/recent-${index}.dmp`, index * 60_000);
    dump('completed/old.dmp', 15 * DAY);

    expect(pruneCrashDumps(NOW, root)).toBe(3);
    expect(
      listCrashDumps(root)
        .map((entry) => path.basename(entry.path))
        .sort(),
    ).toEqual(['recent-0.dmp', 'recent-1.dmp', 'recent-2.dmp', 'recent-3.dmp', 'recent-4.dmp']);

    dump('completed/stale.dmp', 20 * DAY);
    expect(pruneCrashDumps(NOW, root)).toBe(1);
  });

  it('reads a missing crash directory as no crash files', () => {
    expect(summarizeCrashFiles(path.join(root, 'absent'))).toEqual({ count: 0, bytes: 0 });
  });
});
