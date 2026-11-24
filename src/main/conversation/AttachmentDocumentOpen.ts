import { lstat, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { assertAttachmentPreviewPath } from './attachmentPreview';
import type { ConversationAccessAttachmentResult } from '@shared/types/conversation';

const COPY_PREFIX = 'document-';
const COPY_RETENTION_MS = 24 * 60 * 60 * 1000;

/** Associated applications can keep a copy after Electron exits. Age out idle copies on later launches. */
export async function pruneAttachmentDocumentCopies(root: string): Promise<void> {
  try {
    assertAttachmentPreviewPath(root, root);
    const entries = await readdir(root, { withFileTypes: true });
    const cutoff = Date.now() - COPY_RETENTION_MS;
    for (const entry of entries) {
      if (!entry.isDirectory() || !/^document-[a-z0-9]{6}$/iu.test(entry.name)) continue;
      const directory = assertAttachmentPreviewPath(root, join(root, entry.name));
      try {
        if ((await lstat(directory)).mtimeMs >= cutoff) continue;
        const children = await readdir(directory, { withFileTypes: true });
        if (children.some((child) => !child.isFile())
          || (children.length > 1 && children.some((child) => child.name.startsWith('~$')))) continue;
        const timestamps = await Promise.all(children.map(async (child) => (await lstat(join(directory, child.name))).mtimeMs));
        if (timestamps.every((mtime) => mtime < cutoff)) await rm(directory, { recursive: true, force: true });
      } catch (error) {
        if (!['EBUSY', 'EPERM', 'EACCES', 'ENOENT'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') console.warn('[attachments] Could not clean document copies', error);
  }
}

export async function openAttachmentDocumentCopy(options: {
  root: string;
  fileName: string;
  bytes: Buffer;
  canOpen: () => boolean;
  openPath: (file: string) => Promise<string>;
}): Promise<ConversationAccessAttachmentResult> {
  let directory: string | undefined;
  let opened = false;
  try {
    await pruneAttachmentDocumentCopies(options.root);
    await mkdir(options.root, { recursive: true, mode: 0o700 });
    assertAttachmentPreviewPath(options.root, options.root);
    directory = await mkdtemp(join(options.root, COPY_PREFIX));
    const file = join(directory, options.fileName);
    await writeFile(file, options.bytes, { flag: 'wx', mode: 0o600 });
    if (!options.canOpen()) return { kind: 'error', code: 'denied' };
    opened = !(await options.openPath(assertAttachmentPreviewPath(directory, file)));
    return opened ? { kind: 'opened' } : { kind: 'error', code: 'openFailed' };
  } catch {
    return { kind: 'error', code: 'openFailed' };
  } finally {
    if (directory && !opened) {
      await rm(directory, { recursive: true, force: true }).catch((error: unknown) => {
        console.warn('[attachments] Could not remove an unopened document copy', error);
      });
    }
  }
}
