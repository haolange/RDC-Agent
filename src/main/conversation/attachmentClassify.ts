import { extname } from 'node:path';
import type { AttachmentLayer, AttachmentRejectCode } from '@shared/types/conversation';
import type { SessionAttachmentKind } from '@shared/types/session';

export const MAX_ATTACHMENT_COUNT = 32;
export const MAX_ATTACHMENT_BYTES_PER_FILE = 64 * 1024 * 1024;
export const MAX_ATTACHMENT_TOTAL_BYTES = 96 * 1024 * 1024;
export const MAX_DECODED_IMAGE_BYTES = 32 * 1024 * 1024;
export const ATTACHMENT_INLINE_TOKEN_BUDGET = 24_000;
export const ATTACHMENT_INLINE_BUDGET_RATIO = 0.1;
export const MAX_IMAGE_PIXELS = 40_000_000;
export const MAX_IMAGE_EDGE = 16_384;

export const NATIVE_IMAGE_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
]);

const TEXT_EXTENSIONS = new Set([
  '.txt',
  '.md',
  '.markdown',
  '.json',
  '.jsonc',
  '.csv',
  '.tsv',
  '.xml',
  '.yml',
  '.yaml',
  '.toml',
  '.ini',
  '.log',
  '.css',
  '.scss',
  '.less',
  '.html',
  '.htm',
  '.js',
  '.jsx',
  '.ts',
  '.tsx',
  '.mjs',
  '.cjs',
  '.py',
  '.rb',
  '.go',
  '.rs',
  '.java',
  '.kt',
  '.c',
  '.h',
  '.cpp',
  '.hpp',
  '.cs',
  '.swift',
  '.sql',
  '.graphql',
  '.proto',
]);

const EXECUTABLE_EXTENSIONS = new Set([
  '.exe',
  '.dll',
  '.so',
  '.dylib',
  '.bin',
  '.com',
  '.msi',
  '.bat',
  '.cmd',
  '.ps1',
  '.sh',
  '.bash',
  '.zsh',
  '.fish',
  '.app',
  '.scr',
  '.pif',
  '.cpl',
]);

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.tif', '.tiff']);
const PDF_EXTENSIONS = new Set(['.pdf']);
const ARCHIVE_EXTENSIONS = new Set(['.zip', '.7z', '.rar', '.tar', '.gz', '.tgz', '.bz2']);
const RDC_EXTENSIONS = new Set(['.rdc']);

const MIME_BY_EXTENSION: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.markdown': 'text/markdown',
  '.json': 'application/json',
  '.csv': 'text/csv',
  '.xml': 'application/xml',
  '.yml': 'text/yaml',
  '.yaml': 'text/yaml',
  '.log': 'text/plain',
};

export interface AttachmentClassification {
  layer: AttachmentLayer;
  mimeType: string;
  kind: SessionAttachmentKind;
  rejectCode?: AttachmentRejectCode;
  rejectMessage?: string;
}

function fileExtension(fileName: string): string {
  return extname(fileName).toLowerCase();
}

function looksLikeUtf8(bytes: Buffer): boolean {
  if (bytes.length === 0) return true;
  if (bytes.includes(0)) return false;
  try {
    const decoded = bytes.toString('utf8');
    return Buffer.from(decoded, 'utf8').equals(bytes);
  } catch {
    return false;
  }
}

function isPng(bytes: Buffer): boolean {
  return bytes.length >= 8
    && bytes[0] === 0x89
    && bytes[1] === 0x50
    && bytes[2] === 0x4e
    && bytes[3] === 0x47;
}

function isJpeg(bytes: Buffer): boolean {
  return bytes.length >= 3
    && bytes[0] === 0xff
    && bytes[1] === 0xd8
    && bytes[2] === 0xff;
}

function isGif(bytes: Buffer): boolean {
  return bytes.length >= 6
    && bytes[0] === 0x47
    && bytes[1] === 0x49
    && bytes[2] === 0x46
    && bytes[3] === 0x38
    && (bytes[4] === 0x37 || bytes[4] === 0x39)
    && bytes[5] === 0x61;
}

function isWebp(bytes: Buffer): boolean {
  return bytes.length >= 12
    && bytes.toString('ascii', 0, 4) === 'RIFF'
    && bytes.toString('ascii', 8, 12) === 'WEBP';
}

function isPdf(bytes: Buffer): boolean {
  return bytes.length >= 5 && bytes.toString('ascii', 0, 5) === '%PDF-';
}

function isZip(bytes: Buffer): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b
    && (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07)
    && (bytes[3] === 0x04 || bytes[3] === 0x06 || bytes[3] === 0x08);
}

function isSvg(bytes: Buffer, declaredMime: string | null | undefined): boolean {
  if ((declaredMime ?? '').toLowerCase() === 'image/svg+xml') return true;
  const head = bytes.subarray(0, Math.min(bytes.length, 512)).toString('utf8').trimStart().toLowerCase();
  return head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg'));
}

function isPe(bytes: Buffer): boolean {
  return bytes.length >= 2 && bytes[0] === 0x4d && bytes[1] === 0x5a;
}

function isElf(bytes: Buffer): boolean {
  return bytes.length >= 4
    && bytes[0] === 0x7f
    && bytes[1] === 0x45
    && bytes[2] === 0x4c
    && bytes[3] === 0x46;
}

function isMachO(bytes: Buffer): boolean {
  if (bytes.length < 4) return false;
  const magic = bytes.readUInt32BE(0);
  return magic === 0xFEEDFACE
    || magic === 0xFEEDFACF
    || magic === 0xCEFAEDFE
    || magic === 0xCFFAEDFE
    || magic === 0xCAFEBABE
    || magic === 0xBEBAFECA;
}

function isExecutableMagic(bytes: Buffer): boolean {
  return isPe(bytes) || isElf(bytes) || isMachO(bytes);
}

function reject(code: AttachmentRejectCode, message: string): AttachmentClassification {
  return {
    layer: 'binary',
    mimeType: 'application/octet-stream',
    kind: 'file',
    rejectCode: code,
    rejectMessage: message,
  };
}

function accept(layer: AttachmentLayer, mimeType: string): AttachmentClassification {
  return {
    layer,
    mimeType,
    kind: layer === 'image' ? 'image' : 'file',
  };
}

export function detectImageMagicMime(bytes: Buffer): string | null {
  if (isPng(bytes)) return 'image/png';
  if (isJpeg(bytes)) return 'image/jpeg';
  if (isGif(bytes)) return 'image/gif';
  if (isWebp(bytes)) return 'image/webp';
  return null;
}

export function inferAttachmentMimeType(
  fileName: string,
  declaredMime?: string | null,
): string | null {
  const declared = (declaredMime ?? '').trim().toLowerCase();
  if (declared) return declared;
  return MIME_BY_EXTENSION[fileExtension(fileName)] ?? null;
}

export function layerFromPersistedKind(
  kind: SessionAttachmentKind,
  mimeType: string,
  fileName: string,
): AttachmentLayer {
  if (kind === 'image' && NATIVE_IMAGE_MIME_TYPES.has(mimeType)) return 'image';
  if (mimeType === 'application/pdf' || fileExtension(fileName) === '.pdf') return 'pdf';
  if (mimeType.startsWith('text/') || TEXT_EXTENSIONS.has(fileExtension(fileName))) return 'text';
  return 'binary';
}

export function readImageDimensions(mimeType: string, bytes: Buffer): { width: number; height: number } | null {
  try {
    if (mimeType === 'image/png' && bytes.length >= 24) {
      return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
    }
    if (mimeType === 'image/gif' && bytes.length >= 10) {
      return { width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) };
    }
    if (mimeType === 'image/webp' && bytes.length >= 30) {
      const chunk = bytes.subarray(12, 16).toString('ascii');
      if (chunk === 'VP8X' && bytes.length >= 30) {
        return { width: 1 + bytes.readUIntLE(24, 3), height: 1 + bytes.readUIntLE(27, 3) };
      }
      if (chunk === 'VP8 ' && bytes.length >= 30) {
        return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
      }
    }
    if (mimeType === 'image/jpeg') {
      let offset = 2;
      while (offset + 9 < bytes.length) {
        if (bytes[offset] !== 0xff) break;
        const marker = bytes[offset + 1];
        if (marker === 0xd8 || marker === 0xd9) {
          offset += 2;
          continue;
        }
        const length = bytes.readUInt16BE(offset + 2);
        if (marker >= 0xc0 && marker <= 0xc3 && offset + 8 < bytes.length) {
          return { height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7) };
        }
        offset += 2 + length;
      }
    }
  } catch {
    return null;
  }
  return null;
}

export function assertSafeImageBytes(
  fileName: string,
  mimeType: string,
  bytes: Buffer,
): void {
  if (mimeType === 'image/svg+xml' || fileExtension(fileName) === '.svg') {
    throw new Error(`ATTACHMENT_MEDIA_UNSUPPORTED: ${fileName} (image/svg+xml)`);
  }
  if (!NATIVE_IMAGE_MIME_TYPES.has(mimeType)) {
    throw new Error(`ATTACHMENT_MEDIA_UNSUPPORTED: ${fileName} (${mimeType})`);
  }
  const magicMime = detectImageMagicMime(bytes.subarray(0, Math.min(bytes.length, 64)));
  if (!magicMime || magicMime === 'image/svg+xml') {
    throw new Error(`ATTACHMENT_INVALID: ${fileName} magic bytes do not match a supported image`);
  }
  if (magicMime !== mimeType) {
    throw new Error(`ATTACHMENT_INVALID: ${fileName} declared ${mimeType} but content is ${magicMime}`);
  }
  const probe = bytes.subarray(0, Math.min(bytes.length, 256 * 1024));
  const dims = readImageDimensions(magicMime, probe);
  if (!dims) return;
  if (dims.width > MAX_IMAGE_EDGE || dims.height > MAX_IMAGE_EDGE) {
    throw new Error(`ATTACHMENT_INVALID: ${fileName} edge ${dims.width}x${dims.height} exceeds ${MAX_IMAGE_EDGE}`);
  }
  if (dims.width * dims.height > MAX_IMAGE_PIXELS) {
    throw new Error(`ATTACHMENT_INVALID: ${fileName} pixels ${dims.width * dims.height} exceed ${MAX_IMAGE_PIXELS}`);
  }
}

export function classifyAttachmentBytes(
  fileName: string,
  bytes: Buffer,
  declaredMime?: string | null,
): AttachmentClassification {
  const ext = fileExtension(fileName);
  const mime = (declaredMime ?? '').trim().toLowerCase();

  if (RDC_EXTENSIONS.has(ext)) {
    return reject(
      'ATTACHMENT_CAPTURE_USE_PROJECT_IMPORT',
      'Capture files belong in the project Import .rdc surface, not Composer attachments.',
    );
  }
  if (EXECUTABLE_EXTENSIONS.has(ext) || isExecutableMagic(bytes)) {
    return reject('ATTACHMENT_EXECUTABLE_DENIED', 'Executable files cannot be attached.');
  }
  if (isSvg(bytes, mime) || ext === '.svg') {
    return reject('ATTACHMENT_MEDIA_UNSUPPORTED', 'SVG attachments are not supported.');
  }

  if (isPng(bytes)) return accept('image', 'image/png');
  if (isJpeg(bytes)) return accept('image', 'image/jpeg');
  if (isGif(bytes)) return accept('image', 'image/gif');
  if (isWebp(bytes)) return accept('image', 'image/webp');
  if (isPdf(bytes)) return accept('pdf', 'application/pdf');
  if (isZip(bytes) || ARCHIVE_EXTENSIONS.has(ext)) {
    return accept('binary', mime || 'application/zip');
  }

  if (IMAGE_EXTENSIONS.has(ext) || mime.startsWith('image/')) {
    return reject('ATTACHMENT_MEDIA_UNSUPPORTED', 'Image bytes did not match a supported raster format.');
  }
  if (PDF_EXTENSIONS.has(ext) || mime === 'application/pdf') {
    return reject('ATTACHMENT_MEDIA_UNSUPPORTED', 'PDF bytes did not match a valid PDF header.');
  }

  if (TEXT_EXTENSIONS.has(ext) || mime.startsWith('text/')) {
    if (!looksLikeUtf8(bytes)) {
      return reject('ATTACHMENT_MEDIA_UNSUPPORTED', 'Text attachments must be valid UTF-8.');
    }
    return accept('text', mime || MIME_BY_EXTENSION[ext] || 'text/plain');
  }

  return accept('binary', mime || 'application/octet-stream');
}
