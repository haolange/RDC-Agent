import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { afterEach, expect, it } from 'vitest';
import { createExternalCaptureReference, verifyExternalCaptureReference } from './ExternalCaptureReference';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))); });
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rdc-external-reference-')); roots.push(root);
  const file = path.join(root, 'original.rdc'); await fs.writeFile(file, 'RDOCsmall fixture');
  return { root, file };
}
it('registers one exact original without copying or modifying it', async () => {
  const { root, file } = await fixture(); const before = await fs.readFile(file);
  const input = await createExternalCaptureReference(file);
  expect(input.source).toBe('external_reference');
  expect(input.filePath).toBe(await fs.realpath(file));
  expect(await verifyExternalCaptureReference(input)).toEqual(input);
  expect(await fs.readFile(file)).toEqual(before);
  expect(await fs.readdir(root)).toEqual(['original.rdc']);
});
it('rejects changed bytes until explicit registration', async () => {
  const { file } = await fixture(); const input = await createExternalCaptureReference(file);
  await fs.writeFile(file, 'RDOCchanged fixture');
  await expect(verifyExternalCaptureReference(input)).rejects.toThrow('CAPTURE_REFERENCE_CHANGED');
  expect((await createExternalCaptureReference(file)).contentSha256).not.toBe(input.contentSha256);
});
it('rejects a different file with identical bytes', async () => {
  const { root, file } = await fixture(); const input = await createExternalCaptureReference(file);
  await fs.rename(file, path.join(root, 'saved.rdc')); await fs.writeFile(file, 'RDOCsmall fixture');
  await expect(verifyExternalCaptureReference(input)).rejects.toThrow('CAPTURE_REFERENCE_CHANGED');
});
it('reports a missing original instead of returning empty success', async () => {
  const { file } = await fixture(); const input = await createExternalCaptureReference(file);
  await fs.unlink(file);
  await expect(verifyExternalCaptureReference(input)).rejects.toHaveProperty('code', 'ENOENT');
});
it('rejects relative, non-RDC, malformed and incomplete registrations', async () => {
  const { file } = await fixture();
  await expect(createExternalCaptureReference('relative.rdc')).rejects.toThrow('INVALID_PATH');
  await expect(createExternalCaptureReference(file + '.txt')).rejects.toThrow('INVALID_PATH');
  await fs.writeFile(file, 'not a capture');
  await expect(createExternalCaptureReference(file)).rejects.toThrow('INVALID_RDC');
  await fs.writeFile(file, 'RDOCsmall fixture'); const input = await createExternalCaptureReference(file);
  await expect(verifyExternalCaptureReference({ ...input, referenceIdentity: undefined })).rejects.toThrow('INVALID_RECORD');
});
it('rejects directory links and hardlinked source aliases', async () => {
  const { root, file } = await fixture(); const alias = path.join(root, 'alias');
  await fs.symlink(root, alias, 'junction');
  await expect(createExternalCaptureReference(path.join(alias, 'original.rdc'))).rejects.toThrow('UNSAFE_LINK');
  await fs.unlink(alias);
  const hardlink = path.join(root, 'alias.rdc'); await fs.link(file, hardlink);
  await expect(createExternalCaptureReference(hardlink)).rejects.toThrow('UNSAFE_FILE');
});
