import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { configuredInstallationRoot, detectRdcInstallations, resolveRdcInstallation } from './RdcInstallationService';

const roots: string[] = [];
afterEach(() => { vi.unstubAllEnvs(); for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc 安装 space-')); roots.push(root);
  for (const relative of ['binaries/windows/x64/python/python.exe', 'cli/run_cli.py']) {
    const file = path.join(root, relative); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, 'fixture');
  }
  return { root, env: {}, timeoutMs: 30000 };
}
describe.skipIf(process.platform !== 'win32')('RDC Windows installation', () => {
  it('derives a single binding for spaces and Unicode without executing anything', () => {
    const request = fixture(); const result = resolveRdcInstallation(request);
    expect(result.argsPrefix).toEqual([path.join(request.root, 'cli/run_cli.py')]);
    expect(configuredInstallationRoot(result)).toBe(request.root);
  });
  it('rejects incomplete, relative and redirected installations', () => {
    const request = fixture(); fs.unlinkSync(path.join(request.root, 'cli/run_cli.py'));
    expect(() => resolveRdcInstallation(request)).toThrow();
    expect(() => resolveRdcInstallation({ ...request, root: 'relative' })).toThrow('absolute');
    const valid = fixture();
    expect(() => resolveRdcInstallation({ ...valid, env: { PYTHONPATH: 'other' } })).toThrow('redirect');
  });
  it('detects only configured/default candidates and reports stale installations', () => {
    const request = fixture(); const settings = resolveRdcInstallation(request);
    vi.stubEnv('LOCALAPPDATA', request.root);
    fs.unlinkSync(settings.command);
    expect(detectRdcInstallations(settings)).toEqual([expect.objectContaining({ root: request.root, source: 'configured', problem: expect.any(String) })]);
  });
  it('rejects a CLI directory junction into a second installation', () => {
    const first = fixture(); const second = fixture();
    const cli = path.join(first.root, 'cli');
    fs.unlinkSync(path.join(cli, 'run_cli.py')); fs.rmdirSync(cli);
    fs.symlinkSync(path.join(second.root, 'cli'), cli, 'junction');
    try { expect(() => resolveRdcInstallation(first)).toThrow('same installation'); }
    finally { fs.unlinkSync(cli); }
  });
});
