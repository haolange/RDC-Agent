import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach } from 'vitest';
import type { AttachmentLayer } from '@shared/types/conversation';

/**
 * Shared setup for the main-process attachment tests: one temporary root per test file, emptied after each test,
 * file attachments described from the bytes actually written, and the text a materialized input carries.
 */

/** A temporary root that exists for every test of the calling file and is removed after each one. */
export function attachmentTempRoot(prefix: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  beforeEach(() => fs.mkdirSync(root, { recursive: true }));
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

/** Writes `contents` under `root` and describes it as a file attachment of `layer` with its real size. */
export function writeFileAttachment(
  root: string,
  fileName: string,
  contents: string | Buffer,
  layer: Extract<AttachmentLayer, 'text' | 'binary' | 'pdf'>,
  mimeType: string,
) {
  const filePath = path.join(root, fileName);
  fs.writeFileSync(filePath, contents);
  return { kind: 'file' as const, layer, fileName, filePath, mimeType, size: fs.statSync(filePath).size };
}

/** The text of a materialized user input: the string itself, or its leading text block. */
export function materializedText(content: string | ReadonlyArray<{ type: string; text?: string }>): string {
  if (typeof content === 'string') return content;
  const [first] = content;
  return first?.type === 'text' ? first.text ?? '' : '';
}
