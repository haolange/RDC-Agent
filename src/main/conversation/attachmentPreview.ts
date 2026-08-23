import * as fs from 'fs';
import * as path from 'path';

const MAX_EDGE = 512;
const CARD_EDGE = 144;
const FALLBACK_MAX_BYTES = 512 * 1024;

export interface AttachmentThumbnail {
  data: Buffer;
  mimeType: string;
  width?: number;
  height?: number;
}

function loadNativeImage(): typeof import('electron').nativeImage | null {
  try {
    return require('electron').nativeImage as typeof import('electron').nativeImage;
  } catch {
    return null;
  }
}

function assertNoSymlinkPath(target: string): void {
  let current = path.resolve(target);
  while (fs.existsSync(current)) {
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) {
      throw new Error(`IMAGE_PREVIEW_PATH_ESCAPE: refusing to follow symlink/reparse path ${current}.`);
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
}

export function resizeAttachmentThumbnail(
  bytes: Buffer,
  mimeType: string,
  maxEdge = MAX_EDGE,
): AttachmentThumbnail {
  try {
    const nativeImage = loadNativeImage();
    if (!nativeImage) throw new Error('no-electron');
    const image = nativeImage.createFromBuffer(bytes);
    if (image.isEmpty()) {
      throw new Error('empty');
    }
    const size = image.getSize();
    const scale = Math.min(1, maxEdge / Math.max(size.width, size.height, 1));
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

export function createCardThumbnail(bytes: Buffer, mimeType: string): AttachmentThumbnail {
  return resizeAttachmentThumbnail(bytes, mimeType, CARD_EDGE);
}

export function toDataUrl(bytes: Buffer, mimeType: string): string {
  return `data:${mimeType};base64,${bytes.toString('base64')}`;
}

export function assertAttachmentPreviewPath(rootPath: string, filePath: string): string {
  const resolvedRoot = path.resolve(rootPath);
  const resolvedFile = path.resolve(filePath);
  const lexicalRelative = path.relative(resolvedRoot, resolvedFile);
  if (lexicalRelative.startsWith('..') || path.isAbsolute(lexicalRelative)) {
    throw new Error('IMAGE_PREVIEW_PATH_ESCAPE');
  }
  if (fs.existsSync(resolvedRoot)) {
    assertNoSymlinkPath(resolvedRoot);
  }
  if (!fs.existsSync(resolvedFile)) {
    return resolvedFile;
  }
  assertNoSymlinkPath(resolvedFile);
  const realRoot = fs.existsSync(resolvedRoot) ? fs.realpathSync(resolvedRoot) : resolvedRoot;
  const realFile = fs.realpathSync(resolvedFile);
  const relative = path.relative(realRoot, realFile);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('IMAGE_PREVIEW_PATH_ESCAPE');
  }
  return realFile;
}

export function readAttachmentFilePreviewDataUrl(filePath: string, mimeType: string): string | null {
  if (!filePath || !fs.existsSync(filePath)) return null;
  const bytes = fs.readFileSync(filePath);
  const thumb = resizeAttachmentThumbnail(bytes, mimeType);
  return toDataUrl(thumb.data, thumb.mimeType);
}
