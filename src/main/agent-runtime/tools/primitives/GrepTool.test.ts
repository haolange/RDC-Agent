import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { grepTool } from './GrepTool';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('grepTool', () => {
  it('searches files and directories with case options', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-grep-'));
    tempDirs.push(root);
    fs.writeFileSync(path.join(root, 'a.ts'), 'Hello World\nhello again\n');
    fs.mkdirSync(path.join(root, 'src'));
    fs.writeFileSync(path.join(root, 'src', 'b.ts'), 'nope\nTARGET\n');

    const dirHit = await grepTool.execute(
      'tc-1',
      { pattern: 'hello', caseSensitive: false, maxMatches: 10 },
      undefined,
      undefined,
      { workspaceRoot: root, projectRootPath: root, projectId: null, sessionId: null },
    );
    expect(dirHit.details?.matchedLines).toBeGreaterThanOrEqual(1);

    const fileHit = await grepTool.execute(
      'tc-2',
      { pattern: 'TARGET', path: 'src/b.ts', caseSensitive: true },
      undefined,
      undefined,
      { workspaceRoot: root, projectRootPath: root, projectId: null, sessionId: null },
    );
    expect(fileHit.details?.matchedFiles).toBe(1);

    const none = await grepTool.execute(
      'tc-3',
      { pattern: 'zzz-not-found' },
      undefined,
      undefined,
      { workspaceRoot: root, projectRootPath: root, projectId: null, sessionId: null },
    );
    expect(none.content[0]).toMatchObject({ type: 'text' });
    expect(String((none.content[0] as { text: string }).text)).toMatch(/no matches/);
  });

  it('aborts when signal is aborted', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-grep-'));
    tempDirs.push(root);
    fs.writeFileSync(path.join(root, 'a.ts'), 'hello');
    const controller = new AbortController();
    controller.abort();
    await expect(grepTool.execute(
      'tc-4',
      { pattern: 'hello' },
      controller.signal,
      undefined,
      { workspaceRoot: root, projectRootPath: root, projectId: null, sessionId: null },
    )).rejects.toThrow(/Abort/i);
  });
});
