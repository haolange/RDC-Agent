import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { openedFileIdentity, sameFileState } from './fileIdentity';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

it('reports one state for an unchanged file and a different one after the name is replaced', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-file-identity-'));
  roots.push(root);
  const file = path.join(root, 'capture.rdc');
  fs.writeFileSync(file, 'RDOC-a');
  const first = await openedFileIdentity(file);
  expect(sameFileState(first, await openedFileIdentity(file))).toBe(true);
  fs.writeFileSync(path.join(root, 'next.rdc'), 'RDOC-b');
  fs.renameSync(path.join(root, 'next.rdc'), file);
  expect(sameFileState(first, await openedFileIdentity(file))).toBe(false);
});
