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

  it('keeps the previous durable JSON when the process dies before rename', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-fault-pre-rename-'));
    roots.push(root);
    const filePath = path.join(root, 'projects.json');
    const io = new StorageIo();
    const durable = { schemaVersion: '1', projects: [{ projectId: 'kept' }] };
    io.writeJsonAtomic(filePath, durable);
    const worker = path.join(root, 'writer-pre-rename.cjs');
    fs.writeFileSync(worker, `
const fs = require('fs');
const filePath = process.env.FAULT_FILE;
const tmp = filePath + '.' + process.pid + '.tmp';
fs.writeFileSync(tmp, JSON.stringify({ schemaVersion: '1', projects: [{ projectId: 'lost' }] }));
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
    expect(io.readJson(filePath)).toEqual(durable);
    expect(fs.existsSync(filePath)).toBe(true);
  });
});

describe('faultInjectionContract: two processes writing project registry', () => {
  it('serializes registry writes through directoryFileLock and stays migration-valid', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-fault-registry-xproc-'));
    roots.push(root);
    const filePath = path.join(root, 'registry.json');
    const io = new StorageIo();
    io.writeJsonAtomic(filePath, { schemaVersion: '1', projects: [] });
    const workerPath = path.join(root, 'worker.cjs');
    const registerPath = path.resolve(__dirname, '../../../../scripts/register-ts-source.cjs');
    const lockPath = path.resolve(__dirname, '../../sessions/directoryFileLock.ts');
    const ioPath = path.resolve(__dirname, '../../sessions/StorageIo.ts');
    const schemaPath = path.resolve(__dirname, '../../sessions/storageSchema.ts');
    fs.writeFileSync(workerPath, `
require(${JSON.stringify(registerPath)});
const { withDirectoryFileLockSync } = require(${JSON.stringify(lockPath)});
const { StorageIo } = require(${JSON.stringify(ioPath)});
const { PROJECT_REGISTRY_MIGRATIONS } = require(${JSON.stringify(schemaPath)});
const filePath = process.env.REGISTRY_FILE;
const project = JSON.parse(process.env.REGISTRY_PROJECT);
const dir = require('path').dirname(filePath);
withDirectoryFileLockSync(dir, { lockFileName: '.registry.lock', timeoutCode: 'PROJECT_REGISTRY_LOCK_TIMEOUT' }, () => {
  const io = new StorageIo();
  const current = io.readJson(filePath, PROJECT_REGISTRY_MIGRATIONS) || { schemaVersion: '1', projects: [] };
  current.projects.push(project);
  io.writeJsonAtomic(filePath, current);
});
`, 'utf8');

    const makeProject = (projectId: string) => ({
      projectId,
      name: projectId,
      rootPath: `D:/${projectId}`,
      slug: projectId,
      resourcePath: `D:/${projectId}/.rdc-agent`,
      knowledgePath: `D:/${projectId}/.rdc-agent/knowledge`,
      inputsPath: `D:/${projectId}/.rdc-agent/inputs`,
      inputs: [],
      inputsUpdatedAt: 1,
      createdAt: 1,
      updatedAt: 1,
    });

    const spawnWorker = (projectId: string) => new Promise<{ code: number | null; stderr: string }>((resolve, reject) => {
      const child = spawn(process.execPath, [workerPath], {
        env: {
          ...process.env,
          REGISTRY_FILE: filePath,
          REGISTRY_PROJECT: JSON.stringify(makeProject(projectId)),
        },
        windowsHide: true,
      });
      let stderr = '';
      child.stderr.on('data', (chunk) => { stderr += String(chunk); });
      child.on('error', reject);
      child.on('close', (code) => resolve({ code, stderr }));
    });

    const [first, second] = await Promise.all([
      spawnWorker('proj_a'),
      spawnWorker('proj_b'),
    ]);
    expect(first.code, first.stderr).toBe(0);
    expect(second.code, second.stderr).toBe(0);
    const { parseStoredDocument, PROJECT_REGISTRY_MIGRATIONS } = await import('../../sessions/storageSchema');
    const parsed = parseStoredDocument(
      JSON.parse(fs.readFileSync(filePath, 'utf8')),
      PROJECT_REGISTRY_MIGRATIONS,
      filePath,
    );
    expect(parsed.projects.map((project) => project.projectId).sort()).toEqual(['proj_a', 'proj_b']);
  }, 20_000);
});
