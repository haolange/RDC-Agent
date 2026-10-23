import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import type { ToolExecutionContext } from '../../agent/AgentTool';
import { readFileTool } from './ReadFileTool';
import { READ_FILE_MAX_OUTPUT_BYTES } from './toolLimits';

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe('ReadFileTool', () => {
  it('keeps the digest header within the text output budget', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rdc-read-file-budget-'));
    roots.push(root);
    const bytes = Buffer.alloc(READ_FILE_MAX_OUTPUT_BYTES + 1024, 'x');
    await writeFile(path.join(root, 'long.txt'), bytes);
    const result = await readFileTool.execute('hash-budget', { path: 'long.txt' }, undefined, undefined, {
      workspaceRoot: root, projectRootPath: root, projectId: null, sessionId: null,
    });
    const text = result.content[0]?.type === 'text' ? result.content[0].text : '';
    expect(Buffer.byteLength(text)).toBeLessThanOrEqual(READ_FILE_MAX_OUTPUT_BYTES);
    expect(result.details).toMatchObject({ truncated: true, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
    expect(text).toContain(`sha256=${result.details?.sha256}`);
  });

  it('hashes exact whole-file bytes while reading a Unicode line window', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rdc-read-file-hash-'));
    roots.push(root);
    const bytes = Buffer.from(`\uFEFF${'甲'.repeat(32768)}\r\n尾\r\n`, 'utf8');
    await writeFile(path.join(root, 'unicode.txt'), bytes);
    const result = await readFileTool.execute('hash-window', { path: 'unicode.txt', offset: 2, limit: 1 }, undefined, undefined, {
      workspaceRoot: root, projectRootPath: root, projectId: null, sessionId: null,
    });
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    expect(result.details).toMatchObject({ bytes: bytes.length, sha256, totalLines: 2, offset: 2, truncated: false });
    const text = result.content[0]?.type === 'text' ? result.content[0].text : '';
    expect(text).toContain(`sha256=${sha256}`);
    expect(text).toContain('2→尾');
    expect(text).not.toContain('甲甲');
    expect(sha256).not.toBe(createHash('sha256').update('尾').digest('hex'));
  });

  it('reads a workspace file with numbered lines', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rdc-read-file-'));
    roots.push(root);
    await writeFile(path.join(root, 'sample.txt'), 'alpha\nbeta\ngamma\n', 'utf8');
    const context: ToolExecutionContext = {
      workspaceRoot: root,
      projectRootPath: root,
      projectId: null,
      sessionId: null,
    };

    const result = await readFileTool.execute('r1', { path: 'sample.txt' }, undefined, undefined, context);
    const text = result.content[0]?.type === 'text' ? result.content[0].text : '';
    expect(text).toContain('alpha');
    expect(text).toContain('beta');
    expect(result.details).toMatchObject({
      totalLines: 3,
      offset: 1,
      truncated: false,
    });
  });

  it('rejects paths outside the workspace', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rdc-read-escape-'));
    roots.push(root);
    const context: ToolExecutionContext = {
      workspaceRoot: root,
      projectRootPath: root,
      projectId: null,
      sessionId: null,
    };

    await expect(readFileTool.execute('r2', { path: '../outside.txt' }, undefined, undefined, context))
      .rejects.toThrow(/超出 workspace/);
  });

  it('rejects RenderDoc .rdc captures', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rdc-read-rdc-'));
    roots.push(root);
    const rdc = path.join(root, 'WhiteHair.rdc');
    await writeFile(rdc, Buffer.from('RDOC\0\0\0binary-capture'));
    const context: ToolExecutionContext = {
      workspaceRoot: root,
      projectRootPath: root,
      projectId: null,
      sessionId: null,
    };

    await expect(readFileTool.execute('r3', { path: 'WhiteHair.rdc' }, undefined, undefined, context))
      .rejects.toThrow(/RenderDoc|\.rdc|binary/i);
  });

  it('reads native diagnostic text without mistaking its prefix for a capture', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rdc-read-log-'));
    roots.push(root);
    const text = 'RDOC 001234: [12:34:56] runtime.cpp - Log - connected\n';
    await writeFile(path.join(root, 'diagnostic.log'), text, 'utf8');
    const context: ToolExecutionContext = {
      workspaceRoot: root, projectRootPath: root, projectId: null, sessionId: null,
    };
    const result = await readFileTool.execute('read-log', { path: 'diagnostic.log' }, undefined, undefined, context);
    expect(JSON.stringify(result.content)).toContain('RDOC 001234:');
    expect(result.details).toMatchObject({ totalLines: 1, bytes: Buffer.byteLength(text), truncated: false });
  });

  it('still refuses session-artifacts even with an absolute path', async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), 'rdc-read-ws-'));
    const sessionRoot = await mkdtemp(path.join(os.tmpdir(), 'rdc-read-session-'));
    roots.push(workspace, sessionRoot);
    const artifact = path.join(sessionRoot, 'session-artifacts', 'tool-outputs', 'offload.json');
    await mkdir(path.dirname(artifact), { recursive: true });
    await writeFile(artifact, '{"secret":true}', 'utf8');
    const context: ToolExecutionContext = {
      workspaceRoot: workspace,
      projectRootPath: workspace,
      projectId: null,
      sessionId: 'sess-1',
    };

    await expect(readFileTool.execute('r4', { path: artifact }, undefined, undefined, context))
      .rejects.toThrow(/超出 workspace|workspace/);
  });
});
