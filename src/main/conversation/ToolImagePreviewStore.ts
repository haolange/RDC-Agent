import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { storageAdapter } from '../sessions/StorageAdapter';
import {
  assertSafeImageAttachment,
  detectImageMagicMime,
} from './ConversationAttachmentMaterializer';

const ACCEPTED_IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

const PREVIEW_DIR = 'image-previews';
const MAX_EDGE = 512;
const FALLBACK_MAX_BYTES = 512 * 1024;

export interface ToolImagePreviewRecord {
  previewId: string;
  toolCallId: string;
  fileName: string;
  mimeType: string;
  width?: number;
  height?: number;
}

function previewRoot(sessionPath: string): string {
  return path.join(sessionPath, PREVIEW_DIR);
}

function resolveSessionPath(sessionId: string): string {
  const session = storageAdapter.readSession(sessionId);
  const sessionPath = session?.sessionPath?.trim();
  if (!sessionPath) {
    throw new Error(`IMAGE_PREVIEW_SESSION_NOT_FOUND: ${sessionId}`);
  }
  return sessionPath;
}

function loadNativeImage(): typeof import('electron').nativeImage | null {
  try {
    return require('electron').nativeImage as typeof import('electron').nativeImage;
  } catch {
    return null;
  }
}

function resizeThumbnail(bytes: Buffer, mimeType: string): { data: Buffer; mimeType: string; width?: number; height?: number } {
  try {
    const nativeImage = loadNativeImage();
    if (!nativeImage) throw new Error('no-electron');
    const image = nativeImage.createFromBuffer(bytes);
    if (image.isEmpty()) {
      throw new Error('empty');
    }
    const size = image.getSize();
    const scale = Math.min(1, MAX_EDGE / Math.max(size.width, size.height, 1));
    const resized = scale < 1
      ? image.resize({ width: Math.max(1, Math.round(size.width * scale)) })
      : image;
    const nextSize = resized.getSize();
    return { data: resized.toPNG(), mimeType: 'image/png', width: nextSize.width, height: nextSize.height };
  } catch {
    if (bytes.length > FALLBACK_MAX_BYTES) {
      throw new Error('IMAGE_PREVIEW_TOO_LARGE');
    }
    return { data: bytes, mimeType };
  }
}

export async function recordToolImagePreview(input: {
  sessionId: string;
  toolCallId: string;
  fileName: string;
  sourcePath?: string;
  bytes?: Buffer;
  mimeType: string;
}): Promise<ToolImagePreviewRecord> {
  const sessionPath = resolveSessionPath(input.sessionId);
  const bytes = input.bytes ?? (input.sourcePath ? await fs.promises.readFile(input.sourcePath) : null);
  if (!bytes) {
    throw new Error('IMAGE_PREVIEW_EMPTY');
  }
  if (input.sourcePath) {
    await assertSafeImageAttachment(input.sourcePath, input.mimeType, input.fileName);
  } else {
    const magicMime = detectImageMagicMime(bytes.subarray(0, 64));
    if (!magicMime || !ACCEPTED_IMAGE_MIME_TYPES.has(magicMime)) {
      throw new Error(`IMAGE_PREVIEW_INVALID: ${input.fileName} magic bytes do not match a supported image`);
    }
    if (magicMime !== input.mimeType) {
      throw new Error(
        `IMAGE_PREVIEW_INVALID: ${input.fileName} declared ${input.mimeType} but content is ${magicMime}`,
      );
    }
  }
  const thumbnail = resizeThumbnail(bytes, input.mimeType);
  const previewId = crypto.randomBytes(12).toString('hex');
  const root = previewRoot(sessionPath);
  await fs.promises.mkdir(root, { recursive: true });
  const filePath = path.join(root, `${previewId}.png`);
  await fs.promises.writeFile(filePath, thumbnail.data);
  return {
    previewId,
    toolCallId: input.toolCallId,
    fileName: input.fileName,
    mimeType: thumbnail.mimeType,
    width: thumbnail.width,
    height: thumbnail.height,
  };
}

export function readToolImagePreviewDataUrl(sessionId: string, previewId: string): string {
  if (!/^[a-f0-9]{16,64}$/u.test(previewId)) {
    throw new Error('IMAGE_PREVIEW_INVALID_ID');
  }
  const sessionPath = resolveSessionPath(sessionId);
  const filePath = path.join(previewRoot(sessionPath), `${previewId}.png`);
  const resolvedRoot = path.resolve(previewRoot(sessionPath));
  const resolvedFile = path.resolve(filePath);
  if (!resolvedFile.startsWith(resolvedRoot + path.sep)) {
    throw new Error('IMAGE_PREVIEW_PATH_ESCAPE');
  }
  if (!fs.existsSync(resolvedFile)) {
    throw new Error('IMAGE_PREVIEW_NOT_FOUND');
  }
  const bytes = fs.readFileSync(resolvedFile);
  return `data:image/png;base64,${bytes.toString('base64')}`;
}
