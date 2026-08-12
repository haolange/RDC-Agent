import { spawn } from 'node:child_process';
import * as fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { StorageIo } from '../../sessions/StorageIo';

const roots: string[] = [];
afterEach(() => {
  for (const dir of roots.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('faultInjectionContract: main crash storage recovery', () => {
  it('keeps atomically written JSON after the writer process exits uncleanly', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-fault-main-crash-'));
    roots.push(root);
    const filePath = path.join(root, 'projects.json');
    const worker = path.join(root, 'writer.cjs');
    fs.writeFileSync(worker, `
const fs = require('fs');
const path = require('path');
const filePath = process.env.FAULT_FILE;
const dir = path.dirname(filePath);
const tmp = filePath + '.' + process.pid + '.tmp';
fs.writeFileSync(tmp, JSON.stringify({ schemaVersion: '1', projects: [{ projectId: 'p1' }] }));
fs.renameSync(tmp, filePath);
process.exit(1);
`, 'utf8');

    const result = await new Promise<{ code: number | null }>((resolve, reject) => {
      const child = spawn(process.execPath, [worker], {
        env: { ...process.env, FAULT_FILE: filePath },
        windowsHide: true,
      });
      child.on('error', reject);
      child.on('close', (code) => resolve({ code }));
    });
    expect(result.code).toBe(1);
    const io = new StorageIo();
    expect(io.readJson(filePath)).toMatchObject({ schemaVersion: '1' });
  });
});
