import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { appPathService } from '../../../runtime/AppPathService';
import { globTool } from './GlobTool';
import { grepTool } from './GrepTool';
import { readFileTool } from './ReadFileTool';

const text = (result: { content: Array<{ type: string; text?: string }> }) =>
  result.content.map((part) => part.text ?? '').join('\n');

describe('agent file reads stop at crash files and credential stores', () => {
  let tmp = '';
  let workspace = '';
  let context: { workspaceRoot: string; projectRootPath: string; projectId: null; sessionId: null };
  const write = (file: string, content: string) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  };

  beforeEach(() => {
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-read-boundary-')));
    workspace = path.join(tmp, 'workspace');
    const userData = path.join(workspace, 'user-data');
    const userRoot = path.join(workspace, 'home', '.rdc-agent');
    write(path.join(userData, 'state', 'crash', 'pending', 'dump.dmp'), 'marker sk-memory-snapshot\n');
    write(path.join(userData, 'secrets', 'provider.key'), 'marker provider key\n');
    write(path.join(userRoot, 'secrets', 'token'), 'marker user token\n');
    write(path.join(workspace, 'notes.md'), 'marker ordinary note\n');
    // The data directory as the app spells it goes through a link; the tools see the real path.
    fs.symlinkSync(userData, path.join(tmp, 'linked-user-data'), 'dir');
    const linked = path.join(tmp, 'linked-user-data');
    vi.spyOn(appPathService, 'getAppStatePaths').mockReturnValue({
      ...appPathService.getAppStatePaths(),
      appStateRoot: path.join(linked, 'state'),
      secretsPath: path.join(linked, 'secrets'),
    });
    vi.spyOn(appPathService, 'getUserRdcPaths').mockReturnValue({
      ...appPathService.getUserRdcPaths(),
      userRdcRoot: userRoot,
    });
    // A link the agent could plant inside the workspace, pointing into the crash directory.
    fs.symlinkSync(path.join(userData, 'state', 'crash'), path.join(workspace, 'crash-link'), 'dir');
    context = { workspaceRoot: workspace, projectRootPath: workspace, projectId: null, sessionId: null };
  });
  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('refuses to read a minidump or a credential file, directly or through a link', async () => {
    const read = (target: string) => readFileTool.execute('read', { path: target }, undefined, undefined, context);
    await expect(read('user-data/state/crash/pending/dump.dmp')).rejects.toThrow(/^FILE_READ_PROTECTED: /u);
    await expect(read('user-data/secrets/provider.key')).rejects.toThrow(/^FILE_READ_PROTECTED: /u);
    await expect(read('home/.rdc-agent/secrets/token')).rejects.toThrow(/^FILE_READ_PROTECTED: /u);
    await expect(read('crash-link/pending/dump.dmp')).rejects.toThrow(/SYMLINK_PATH_REJECTED|FILE_READ_PROTECTED/u);
    expect(text(await read('notes.md'))).toContain('marker ordinary note');
  });

  it('refuses to grep inside them and never searches or lists them from a directory above', async () => {
    const grep = (params: { pattern: string; path?: string }) =>
      grepTool.execute('grep', params, undefined, undefined, context);
    await expect(grep({ pattern: 'marker', path: 'user-data/state/crash' })).rejects.toThrow(/^FILE_READ_PROTECTED: /u);
    await expect(grep({ pattern: 'marker', path: 'user-data/secrets/provider.key' })).rejects.toThrow(
      /^FILE_READ_PROTECTED: /u,
    );
    const everywhere = text(await grep({ pattern: 'marker' }));
    expect(everywhere).toContain('notes.md');
    expect(everywhere).not.toMatch(/dump\.dmp|provider\.key|token|memory-snapshot/u);

    const listed = text(await globTool.execute('glob', { pattern: '**/*' }, undefined, undefined, context));
    expect(listed).toContain('notes.md');
    expect(listed).not.toMatch(/dump\.dmp|provider\.key|secrets/u);
    await expect(
      globTool.execute('glob', { pattern: '**/*', cwd: 'user-data/secrets' }, undefined, undefined, context),
    ).rejects.toThrow(/^FILE_READ_PROTECTED: /u);
  });
});
