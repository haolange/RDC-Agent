import type { SessionAttachmentRecord } from '@shared/types/session';

export const inferAttachmentKind = (filePath: string): SessionAttachmentRecord['kind'] =>
  /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(filePath) ? 'image' : 'file';

export const inferAttachmentMimeType = (filePath: string): string => {
  const extension = filePath.slice(filePath.lastIndexOf('.')).toLowerCase();
  const mimeByExtension: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp',
    '.svg': 'image/svg+xml',
    '.pdf': 'application/pdf',
    '.txt': 'text/plain',
    '.md': 'text/markdown',
    '.json': 'application/json',
    '.zip': 'application/zip',
    '.7z': 'application/x-7z-compressed',
    '.log': 'text/plain',
    '.rdc': 'application/octet-stream',
  };

  return mimeByExtension[extension] || 'application/octet-stream';
};

export const formatBytes = (size: number | null | undefined): string => {
  if (!size || size <= 0) {
    return '';
  }

  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${Math.round(size / 1024)} KB`;
  }
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
};
