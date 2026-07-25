import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { globTool } from './GlobTool';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('globTool', () => {
  it('matches files under a temporary workspace', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-glob-'));
    tempDirs.push(root);
    fs.mkdirSync(path.join(root, 'src'));
    fs.writeFileSync(path.join(root, 'src', 'a.ts'), 'export {};');
    fs.writeFileSync(path.join(root, 'src', 'b.md'), '# b');
    fs.mkdirSync(path.join(root, 'node_modules', 'pkg'), { recursive: true });
    fs.writeFileSync(path.join(root, 'node_modules', 'pkg', 'x.ts'), 'export {};');

    const result = await globTool.execute(
      'tc-1',
      { pattern: 'src/**/*.{ts,md}' },
      undefined,
      undefined,
      { workspaceRoot: root, projectRootPath: root, projectId: null, sessionId: null },
    );

    expect(result.isError).not.toBe(true);
    expect(result.details?.matched).toBeGreaterThanOrEqual(2);
    const text = result.content.map((part) => ('text' in part ? part.text : '')).join('\n');
    expect(text).toMatch(/a\.ts/);
    expect(text).not.toMatch(/node_modules/);
  });

  it('supports cwd and aborts when signal is aborted', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-glob-'));
    tempDirs.push(root);
    fs.mkdirSync(path.join(root, 'nested'));
    fs.writeFileSync(path.join(root, 'nested', 'c.ts'), 'export {};');

    const found = await globTool.execute(
      'tc-2',
      { pattern: '*.ts', cwd: 'nested' },
      undefined,
      undefined,
      { workspaceRoot: root, projectRootPath: root, projectId: null, sessionId: null },
    );
    expect(found.details?.matched).toBe(1);

    const controller = new AbortController();
    controller.abort();
    await expect(globTool.execute(
      'tc-3',
      { pattern: '**/*' },
      controller.signal,
      undefined,
      { workspaceRoot: root, projectRootPath: root, projectId: null, sessionId: null },
    )).rejects.toThrow(/Aborted/);
  });
});
