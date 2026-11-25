import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { detectImageMagicMime } from '../conversation/attachmentClassify';
import { knowledgeImageMime } from './knowledgeImages';
import { normalizeZipEntryName } from './knowledgeZip';

/**
 * The file a folder package names, resolved inside the package directory. The name must be a plain relative path;
 * the file must be a regular file whose real location stays inside the package, so neither `..`, an absolute path nor
 * a link (to the file or to a directory on the way) can pull outside bytes into the knowledge base.
 */
export async function resolvePackageAsset(packageDir: string, relative: string): Promise<string | null> {
  let name: string;
  try {
    name = normalizeZipEntryName(relative);
  } catch {
    throw new Error(`KNOWLEDGE_ASSET_PATH_INVALID: ${relative}`);
  }
  const target = path.join(packageDir, ...name.split('/'));
  let stat;
  try {
    stat = await fs.lstat(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  if (stat.isSymbolicLink()) throw new Error(`KNOWLEDGE_ASSET_LINK_REJECTED: ${relative}`);
  if (!stat.isFile()) return null;
  const [root, real] = await Promise.all([fs.realpath(packageDir), fs.realpath(target)]);
  const inside = path.relative(root, real);
  if (!inside || inside.startsWith('..') || path.isAbsolute(inside)) {
    throw new Error(`KNOWLEDGE_ASSET_LINK_REJECTED: ${relative}`);
  }
  return target;
}

/** Reads a package image and checks that its bytes are the image format its extension names. */
export async function readPackageImage(packageDir: string, relative: string, maxBytes: number): Promise<Buffer | null> {
  const target = await resolvePackageAsset(packageDir, relative);
  if (!target) return null;
  const bytes = await fs.readFile(target);
  if (bytes.length > maxBytes) return null;
  const declared = knowledgeImageMime(relative);
  const actual = detectImageMagicMime(bytes.subarray(0, Math.min(bytes.length, 64)));
  if (!declared || actual !== declared) {
    throw new Error(`KNOWLEDGE_IMAGE_INVALID: ${relative} is not the ${declared ?? 'image'} its name declares`);
  }
  return bytes;
}
