import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { directoryLinkType } from '../platform/paths';
import { rdcInstallationFiles } from '../platform/rdcLayout';
import {
  configuredInstallationRoot,
  detectRdcInstallations,
  installationRootOfPython,
  resolveRdcInstallation,
} from './RdcInstallationService';

const roots: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
function fixture() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rdc 安装 space-')));
  roots.push(root);
  const installed = rdcInstallationFiles(root);
  for (const file of [installed.python, installed.entry]) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'fixture');
  }
  return { root, env: {}, timeoutMs: 30000 };
}
describe('RDC installation for this host layout', () => {
  it('derives a single binding for spaces and Unicode without executing anything', () => {
    const request = fixture();
    const result = resolveRdcInstallation(request);
    expect(result.command).toBe(rdcInstallationFiles(request.root).python);
    expect(result.argsPrefix).toEqual([path.join(request.root, 'cli/run_cli.py')]);
    expect(configuredInstallationRoot(result)).toBe(request.root);
    expect(installationRootOfPython(result.command)).toBe(request.root);
  });
  it('rejects incomplete, relative and redirected installations', () => {
    const request = fixture();
    fs.unlinkSync(path.join(request.root, 'cli/run_cli.py'));
    expect(() => resolveRdcInstallation(request)).toThrow();
    expect(() => resolveRdcInstallation({ ...request, root: 'relative' })).toThrow('absolute');
    const valid = fixture();
    expect(() => resolveRdcInstallation({ ...valid, env: { PYTHONPATH: 'other' } })).toThrow('redirect');
    expect(() => installationRootOfPython(path.join(valid.root, 'python'))).toThrow('RDC_INSTALLATION_INVALID');
  });
  it('detects only configured/default candidates and reports stale installations', () => {
    const request = fixture();
    const settings = resolveRdcInstallation(request);
    vi.stubEnv('LOCALAPPDATA', request.root);
    fs.unlinkSync(settings.command);
    expect(detectRdcInstallations(settings)).toEqual([
      expect.objectContaining({ root: request.root, source: 'configured', problem: expect.any(String) }),
    ]);
  });
  it('rejects a CLI directory link into a second installation', () => {
    const first = fixture();
    const second = fixture();
    const cli = path.join(first.root, 'cli');
    fs.unlinkSync(path.join(cli, 'run_cli.py'));
    fs.rmdirSync(cli);
    fs.symlinkSync(path.join(second.root, 'cli'), cli, directoryLinkType());
    try {
      expect(() => resolveRdcInstallation(first)).toThrow('same installation');
    } finally {
      fs.unlinkSync(cli);
    }
  });
});
