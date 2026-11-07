import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { grepTool } from './GrepTool';
import { GREP_MAX_LINE_CHARS } from './toolLimits';

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

  it('searches beyond the display limit and returns the matching part of a long line', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-grep-'));
    tempDirs.push(root);
    const needle = 'call_e5b6fbad7251494d805e5f264d695030';
    fs.writeFileSync(path.join(root, 'history.jsonl'), `${'x'.repeat(GREP_MAX_LINE_CHARS + 50)}${needle}\n`);
    const result = await grepTool.execute(
      'long-line', { pattern: `${needle}|call_7da5972126ee4fb5a9314b679b9bc6b0`, path: 'history.jsonl' },
      undefined, undefined, { workspaceRoot: root, projectRootPath: root, projectId: null, sessionId: null },
    );
    expect(result.details).toMatchObject({ matchedFiles: 1, matchedLines: 1, truncated: true });
    expect(result.content[0]).toMatchObject({ type: 'text', text: expect.stringContaining(needle) });
  });

  it('applies regular expressions to the full long line and can report a complete miss', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-grep-'));
    tempDirs.push(root);
    fs.writeFileSync(path.join(root, 'history.txt'), `begin-${'x'.repeat(GREP_MAX_LINE_CHARS + 50)}-end\n`);
    const context = { workspaceRoot: root, projectRootPath: root, projectId: null, sessionId: null };
    const hit = await grepTool.execute('anchored', { pattern: '^begin-x+-end$', path: 'history.txt' }, undefined, undefined, context);
    expect(hit.details).toMatchObject({ matchedFiles: 1, matchedLines: 1, truncated: true });
    const miss = await grepTool.execute('miss', { pattern: '^begin-x+-absent$', path: 'history.txt' }, undefined, undefined, context);
    expect(miss.details).toMatchObject({ matchedFiles: 0, matchedLines: 0, truncated: false });
    const ellipsis = await grepTool.execute('ellipsis', { pattern: '…', path: 'history.txt' }, undefined, undefined, context);
    expect(ellipsis.details).toMatchObject({ matchedFiles: 0, matchedLines: 0, truncated: false });
  });

  it('times out a pathological long-line expression without blocking the main event loop', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-grep-'));
    tempDirs.push(root);
    fs.writeFileSync(path.join(root, 'history.txt'), `${'x'.repeat(GREP_MAX_LINE_CHARS + 50)}!`);
    const context = { workspaceRoot: root, projectRootPath: root, projectId: null, sessionId: null };
    const outcome = grepTool.execute('timeout', { pattern: '^(x+)+$', path: 'history.txt' }, undefined, undefined, context)
      .then(() => null, (error: Error) => error);
    const tick = new Promise<'tick'>((resolve) => setTimeout(() => resolve('tick'), 20));
    expect(await Promise.race([outcome, tick])).toBe('tick');
    expect(await outcome).toMatchObject({ message: expect.stringMatching(/grep pattern timed out/) });
  });

  it('stops an in-progress long-line search when cancelled', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-grep-'));
    tempDirs.push(root);
    fs.writeFileSync(path.join(root, 'history.txt'), `${'x'.repeat(GREP_MAX_LINE_CHARS + 50)}!`);
    const controller = new AbortController();
    const context = { workspaceRoot: root, projectRootPath: root, projectId: null, sessionId: null };
    const outcome = grepTool.execute('cancel', { pattern: '^(x+)+$', path: 'history.txt' }, controller.signal, undefined, context);
    setTimeout(() => controller.abort(), 50);
    await expect(outcome).rejects.toThrow(/Aborted/);
  });
});
