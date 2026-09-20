import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  register: vi.fn((_: string, __: string, record: { filePath: string }) => record),
  runRoot: '',
}));

vi.mock('./ArtifactStore', () => ({ artifactStore: { register: mocks.register } }));
vi.mock('../workflow/debugger/RunScopedStore', () => ({
  runScopedStore: { getRunRoot: () => mocks.runRoot },
}));

import { createOutputRegistrationTool } from './OutputRegistrationTool';

describe('OutputRegistrationTool', () => {
  let root = '';

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-output-register-'));
    mocks.runRoot = path.join(root, '.state', 'run');
    mocks.register.mockClear();
  });

  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  const tool = () => createOutputRegistrationTool({
    sessionId: 'session-a', runId: 'run-a', projectRootPath: root,
  });

  it('copies an explicit project file into the owning run and registers it', async () => {
    fs.writeFileSync(path.join(root, 'report.md'), '# report');

    const result = await tool().execute('call-a', { path: 'report.md', title: 'Capture report', kind: 'report' });

    expect(result.isError).not.toBe(true);
    expect(result.details?.path).toContain(path.join('.state', 'run', 'artifacts'));
    expect(fs.readFileSync(result.details!.path, 'utf8')).toBe('# report');
    expect(mocks.register).toHaveBeenCalledWith('session-a', 'run-a', expect.objectContaining({ title: 'Capture report', kind: 'report' }));
  });

  it('rejects inputs and paths outside the active project', async () => {
    fs.mkdirSync(path.join(root, '.rdc-agent', 'inputs'), { recursive: true });
    fs.writeFileSync(path.join(root, '.rdc-agent', 'inputs', 'capture.rdc'), 'capture');

    await expect(tool().execute('input', { path: '.rdc-agent/inputs/capture.rdc' })).resolves.toMatchObject({ isError: true });
    await expect(tool().execute('escape', { path: '../outside.md' })).resolves.toMatchObject({ isError: true });
    expect(mocks.register).not.toHaveBeenCalled();
  });
});
