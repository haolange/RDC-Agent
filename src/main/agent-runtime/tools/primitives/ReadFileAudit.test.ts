import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile, truncate, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readFileTool } from './ReadFileTool';
import type { ToolExecutionContext } from '../../agent/AgentTool';

const roots: string[] = [];
const hash = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

async function fixture(left: Buffer | string, right: Buffer | string) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'rdc-file-audit-'));
  roots.push(root);
  await writeFile(path.join(root, 'a.bin'), left);
  await writeFile(path.join(root, 'b.bin'), right);
  const context: ToolExecutionContext = {
    workspaceRoot: root, projectRootPath: root, projectId: 'p', sessionId: 's', successfulFileReads: new Set(),
  };
  return { root, context };
}

function audit(params: Parameters<typeof readFileTool.execute>[1], context: ToolExecutionContext, signal?: AbortSignal) {
  return readFileTool.execute('audit', params, signal, undefined, context);
}

describe('hash-bound read_file audit', () => {
  it('compares actual binary buffers without granting read-before-edit or interpreting their header', async () => {
    const bytes = Buffer.from([3, 2, 35, 7, 0, 0, 1, 0, 255]);
    const { context } = await fixture(bytes, bytes);
    const result = await audit({ path: 'a.bin', mode: 'audit', expectedHash: `sha256:${hash(bytes)}`,
      compareWith: { path: 'b.bin', expectedHash: hash(bytes) } }, context);
    expect(result.details).toMatchObject({ mode: 'audit', bytes: 9, sha256: hash(bytes),
      headHex: bytes.toString('hex'), comparison: { bytesEqual: true } });
    expect(context.successfulFileReads?.size).toBe(0);
    await expect(readFileTool.execute('text', { path: 'a.bin' }, undefined, undefined, context)).rejects.toThrow(/binary/);
  });

  it('separates exact byte equality from explicit CRLF-to-LF text equality, preserving BOM and bare CR', async () => {
    const left = '\uFEFFalpha\r\nbeta\rtail\r\n';
    const right = '\uFEFFalpha\nbeta\rtail\n';
    const { context } = await fixture(left, right);
    const result = await audit({ path: 'a.bin', mode: 'audit', expectedHash: hash(left), textComparison: true,
      compareWith: { path: 'b.bin', expectedHash: hash(right) } }, context);
    expect(result.details).toMatchObject({ sha256: hash(left),
      text: { normalization: 'crlf-to-lf', sha256: hash(right) },
      comparison: { bytesEqual: false, text: { equal: true, truncated: false, leftChanged: '', rightChanged: '' } } });
  });

  it('computes a complete changed span while proving the common prefix and suffix outside it', async () => {
    const left = 'first\r\nold\r\nmiddle\r\nlast\r\n';
    const right = 'first\nnew\nmiddle\nextra\nlast\n';
    const { context } = await fixture(left, right);
    const result = await audit({ path: 'a.bin', mode: 'audit', expectedHash: hash(left), textComparison: true,
      compareWith: { path: 'b.bin', expectedHash: hash(right) } }, context);
    expect(result.details).toMatchObject({ comparison: { text: {
      equal: false, commonPrefixLines: 1, commonSuffixLines: 2,
      leftChanged: 'old\nmiddle', rightChanged: 'new\nmiddle\nextra', truncated: false,
    } } });
  });

  it('marks an oversized changed span truncated instead of asserting a complete diff', async () => {
    const left = 'a'.repeat(20000), right = 'b'.repeat(20000);
    const { context } = await fixture(left, right);
    const result = await audit({ path: 'a.bin', mode: 'audit', expectedHash: hash(left), textComparison: true,
      compareWith: { path: 'b.bin', expectedHash: hash(right) } }, context);
    expect(result.details).toMatchObject({ comparison: { bytesEqual: false, text: { equal: false, truncated: true } } });
  });

  it('rejects either changed input, missing expected hash and ambiguous paging', async () => {
    const { context } = await fixture('left', 'right');
    await expect(audit({ path: 'a.bin', mode: 'audit' }, context)).rejects.toThrow(/EXPECTED_HASH/);
    await expect(audit({ path: 'a.bin', mode: 'audit', expectedHash: hash('wrong') }, context)).rejects.toThrow(/HASH_MISMATCH/);
    await expect(audit({ path: 'a.bin', mode: 'audit', expectedHash: hash('left'),
      compareWith: { path: 'b.bin', expectedHash: hash('wrong') } }, context)).rejects.toThrow(/HASH_MISMATCH/);
    await expect(audit({ path: 'a.bin', mode: 'audit', expectedHash: hash('left'), offset: 1 }, context)).rejects.toThrow(/PAGING/);
  });

  it('rejects capture magic, capture extension, non-UTF8 text comparison and cancelled reads', async () => {
    const bytes = Buffer.from([82, 68, 79, 67, 0, 0, 0, 0]);
    const { root, context } = await fixture(bytes, Buffer.from([255, 254]));
    await expect(audit({ path: 'a.bin', mode: 'audit', expectedHash: hash(bytes) }, context)).rejects.toThrow(/CAPTURE/);
    await writeFile(path.join(root, 'capture.rdc'), 'text');
    await expect(audit({ path: 'capture.rdc', mode: 'audit', expectedHash: hash('text') }, context)).rejects.toThrow(/CAPTURE/);
    await expect(audit({ path: 'b.bin', mode: 'audit', expectedHash: hash(Buffer.from([255, 254])), textComparison: true }, context))
      .rejects.toThrow(/UTF8/);
    const controller = new AbortController(); controller.abort();
    await expect(audit({ path: 'b.bin', mode: 'audit', expectedHash: hash(Buffer.from([255, 254])) }, context, controller.signal))
      .rejects.toThrow(/Abort/);
  });

  it('resolves both inputs through existing workspace containment', async () => {
    const { context } = await fixture('left', 'right');
    await expect(audit({ path: 'a.bin', mode: 'audit', expectedHash: hash('left'),
      compareWith: { path: '../outside.bin', expectedHash: hash('outside') } }, context)).rejects.toThrow(/workspace/);
  });

  it('reports the first actual byte difference, including a length-only difference', async () => {
    const { context } = await fixture(Buffer.from([1, 2, 0, 4]), Buffer.from([1, 2, 0]));
    const result = await audit({ path: 'a.bin', mode: 'audit', expectedHash: hash(Buffer.from([1, 2, 0, 4])),
      compareWith: { path: 'b.bin', expectedHash: hash(Buffer.from([1, 2, 0])) } }, context);
    expect(result.details).toMatchObject({ comparison: { bytesEqual: false, firstDifferenceOffset: 3,
      differenceWindow: { offset: 0, leftHex: '01020004', rightHex: '010200' } } });
  });

  it('rejects oversized files and directories and refuses implicit audit options', async () => {
    const { root, context } = await fixture('', 'right');
    await truncate(path.join(root, 'a.bin'), 9 * 1024 * 1024);
    await expect(audit({ path: 'a.bin', mode: 'audit', expectedHash: hash('') }, context)).rejects.toThrow(/SIZE_OR_TYPE/);
    await expect(audit({ path: '.', mode: 'audit', expectedHash: hash('') }, context)).rejects.toThrow(/SIZE_OR_TYPE/);
    await expect(audit({ path: 'b.bin', expectedHash: hash('right') }, context)).rejects.toThrow(/MODE_INVALID/);
  });

  it('rejects a comparison symlink escaping the project', async () => {
    const { root, context } = await fixture('left', 'right');
    const outside = await mkdtemp(path.join(os.tmpdir(), 'rdc-file-audit-outside-'));
    roots.push(outside);
    await writeFile(path.join(outside, 'secret.bin'), 'secret');
    await symlink(outside, path.join(root, 'link'), process.platform === 'win32' ? 'junction' : 'dir');
    await expect(audit({ path: 'a.bin', mode: 'audit', expectedHash: hash('left'),
      compareWith: { path: 'link/secret.bin', expectedHash: hash('secret') } }, context)).rejects.toThrow();
  });
});
