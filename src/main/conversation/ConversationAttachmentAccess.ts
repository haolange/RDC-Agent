import * as fs from 'node:fs';
import { basename } from 'node:path';
import { associatedDocumentMime, attachmentExtension, isMarkdownAttachment } from '@shared/attachmentPresentation';
import { openAttachmentDocumentCopy } from './AttachmentDocumentOpen';
import {
  assertSafeImageBytes, MAX_ATTACHMENT_BYTES_PER_FILE, MAX_DECODED_IMAGE_BYTES, NATIVE_IMAGE_MIME_TYPES,
} from './attachmentClassify';
import { assertAttachmentPreviewPath, toDataUrl } from './attachmentPreview';
import { isOfficeDocument } from './attachmentOfficeDocument';
import type { AttachmentLayer, ConversationAccessAttachmentRequest, ConversationAccessAttachmentResult } from '@shared/types/conversation';

export interface OwnedAttachment {
  root: string;
  filePath: string;
  fileName: string;
  mimeType: string;
  layer: AttachmentLayer;
}

interface AttachmentShell {
  openPath(path: string): Promise<string>;
  showItemInFolder(path: string): void;
}

function matchingDocumentMime(mime: string, expected: string): boolean {
  return mime === expected || (expected !== 'application/pdf'
    && (mime === 'application/zip' || mime === 'application/octet-stream'));
}

function isPdfDocument(bytes: Buffer): boolean {
  if (!/^%PDF-[12]\.\d[\r\n]/u.test(bytes.toString('latin1', 0, 12))) return false;
  const trailer = /(?:^|[\r\n])startxref\s+(\d+)\s+%%EOF[\t\n\f\r ]*$/u.exec(bytes.subarray(-1024).toString('latin1'));
  const offset = Number(trailer?.[1]);
  if (!Number.isSafeInteger(offset) || offset < 9 || offset >= bytes.length) return false;
  const xref = bytes.toString('latin1', offset, Math.min(offset + 8192, bytes.length));
  return /^xref\s+\d+\s+\d+\s+\d{10} \d{5} [nf](?:[\r\n ]|$)/u.test(xref)
    || /^\d+\s+\d+\s+obj\s*<<[\s\S]*?\/Type\s*\/XRef\b/u.test(xref.split(/\bstream\b/u, 1)[0]);
}

function scopedFile(attachment: OwnedAttachment): string | null {
  try {
    return assertAttachmentPreviewPath(attachment.root, attachment.filePath);
  } catch {
    return null;
  }
}

function sameSnapshot(before: fs.Stats, after: fs.Stats): boolean {
  return before.dev === after.dev && before.ino === after.ino && before.size === after.size
    && before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs;
}

async function readAttachmentSnapshot(file: string, stat: fs.Stats): Promise<Buffer | null> {
  const source = await fs.promises.open(file, 'r');
  try {
    if (!sameSnapshot(stat, await source.stat())) return null;
    const bytes = Buffer.allocUnsafe(stat.size);
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await source.read(bytes, offset, bytes.length - offset, offset);
      if (!bytesRead) return null;
      offset += bytesRead;
    }
    return sameSnapshot(stat, await source.stat()) ? bytes : null;
  } finally {
    await source.close();
  }
}

export async function accessOwnedAttachment(
  attachment: OwnedAttachment,
  action: ConversationAccessAttachmentRequest['action'],
  shell: AttachmentShell,
  stillOwned: () => boolean,
  documentCopyRoot: string,
): Promise<ConversationAccessAttachmentResult> {
  const file = scopedFile(attachment);
  if (!file) return { kind: 'error', code: 'denied' };

  const stat = await fs.promises.stat(file);
  if (!stat.isFile()) return { kind: 'error', code: 'unavailable' };
  const canUse = () => stillOwned() && scopedFile(attachment) === file;
  if (action === 'reveal') {
    if (!canUse()) return { kind: 'error', code: 'denied' };
    try {
      shell.showItemInFolder(file);
      return { kind: 'revealed' };
    } catch {
      return { kind: 'error', code: 'revealFailed' };
    }
  }

  const extension = attachmentExtension(attachment.fileName);
  const storedExtension = attachmentExtension(basename(file));
  const mime = attachment.mimeType;
  const image = action === 'preview' && NATIVE_IMAGE_MIME_TYPES.has(mime);
  const markdown = action === 'preview' && attachment.layer === 'text'
    && isMarkdownAttachment(extension) && storedExtension === extension;
  const document = action === 'open' && storedExtension === extension ? associatedDocumentMime(extension) : undefined;
  if (!image && !markdown && (!document || !matchingDocumentMime(mime, document))) {
    return { kind: 'error', code: 'unsupported' };
  }

  const limit = image ? MAX_DECODED_IMAGE_BYTES : MAX_ATTACHMENT_BYTES_PER_FILE;
  if (stat.size > limit) return { kind: 'error', code: 'tooLarge' };
  const bytes = await readAttachmentSnapshot(file, stat);
  if (!bytes) return { kind: 'error', code: 'unavailable' };
  if (!canUse()) return { kind: 'error', code: 'denied' };
  if (image) {
    try {
      assertSafeImageBytes(attachment.fileName, mime, bytes);
      return { kind: 'image', dataUrl: toDataUrl(bytes, mime) };
    } catch {
      return { kind: 'error', code: 'unsupported' };
    }
  }
  if (markdown) {
    try {
      const source = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
      if (!source.includes('\0')) return { kind: 'markdown', source };
    } catch {
      return { kind: 'error', code: 'unsupported' };
    }
    return { kind: 'error', code: 'unsupported' };
  }
  if (!(document === 'application/pdf' ? isPdfDocument(bytes) : isOfficeDocument(bytes, extension))) {
    return { kind: 'error', code: 'unsupported' };
  }
  if (!sameSnapshot(stat, await fs.promises.stat(file)) || !canUse()) {
    return { kind: 'error', code: 'denied' };
  }
  return openAttachmentDocumentCopy({
    root: documentCopyRoot,
    fileName: basename(attachment.fileName),
    bytes,
    canOpen: canUse,
    openPath: (copy) => shell.openPath(copy),
  });
}
