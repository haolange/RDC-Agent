import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { StorageIo } from './StorageIo';
import { writePlanFile } from './planFilePersistence';
const roots: string[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
it('keeps original bytes on write failure and restores them on verification failure', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-plan-file-')); roots.push(root);
  const target = path.join(root, 'plan.md'); fs.writeFileSync(target, 'original');
  const io = new StorageIo();
  vi.spyOn(io, 'writeUtf8AtomicFsync').mockImplementationOnce(() => { throw new Error('write failed'); });
  expect(() => writePlanFile(target, 'new', io)).toThrow('write failed');
  expect(fs.readFileSync(target, 'utf8')).toBe('original');
  vi.mocked(io.writeUtf8AtomicFsync).mockImplementationOnce(file => fs.writeFileSync(file, 'corrupt'));
  expect(() => writePlanFile(target, 'new', io)).toThrow('PLAN_WRITE_VERIFY_FAILED');
  expect(fs.readFileSync(target, 'utf8')).toBe('original');
});
