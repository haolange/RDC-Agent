import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { AppError } from '@shared/errors/appError';

export const KNOWLEDGE_PACKAGE_MANIFEST = 'knowledge.yaml';
export const KNOWLEDGE_PACKAGE_ZIP_MAX_UNCOMPRESSED = 32 * 1024 * 1024;

export function normalizeZipEntryName(name: string): string {
  const posix = name.replace(/\\/g, '/');
  if (
    !posix
    || posix.includes('\0')
    || posix.includes(':')
    || posix.split('/').includes('..')
    || posix.split('/').includes('')
  ) {
    throw new AppError('KNOWLEDGE_ZIP_PATH_INVALID');
  }
  return posix;
}

export function zipKnowledgeFiles(entries: Array<{ name: string; data: Uint8Array }>): Uint8Array {
  let total = 0;
  const record: Record<string, Uint8Array> = {};
  for (const entry of entries) {
    const name = normalizeZipEntryName(entry.name);
    total += entry.data.byteLength;
    if (total > KNOWLEDGE_PACKAGE_ZIP_MAX_UNCOMPRESSED) {
      throw new AppError('KNOWLEDGE_ZIP_TOO_LARGE');
    }
    record[name] = entry.data;
  }
  return zipSync(record, { level: 6 });
}

export function unzipKnowledgeFiles(bytes: Uint8Array): Map<string, Uint8Array> {
  if (bytes.byteLength > KNOWLEDGE_PACKAGE_ZIP_MAX_UNCOMPRESSED) {
    throw new AppError('KNOWLEDGE_ZIP_TOO_LARGE');
  }
  // Entries are budgeted by their declared size before anything is inflated; fflate sizes each output buffer from
  // that declaration, so a header that understates its size cannot inflate past it either.
  let declared = 0;
  let decoded: Record<string, Uint8Array>;
  try {
    decoded = unzipSync(bytes, {
      filter: (entry) => {
        if (entry.name.endsWith('/')) return false;
        declared += entry.originalSize;
        if (declared > KNOWLEDGE_PACKAGE_ZIP_MAX_UNCOMPRESSED) throw new AppError('KNOWLEDGE_ZIP_TOO_LARGE');
        return true;
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'KNOWLEDGE_ZIP_TOO_LARGE') throw error;
    throw new AppError('KNOWLEDGE_ZIP_INVALID', undefined, { cause: error });
  }
  return new Map(Object.entries(decoded).map(([raw, data]) => [normalizeZipEntryName(raw), data]));
}

export function pickKnowledgeYamlEntry(names: Iterable<string>): string | null {
  const list = [...names];
  if (list.includes(KNOWLEDGE_PACKAGE_MANIFEST)) return KNOWLEDGE_PACKAGE_MANIFEST;
  const rootYamls = list.filter((name) => !name.includes('/') && /\.ya?ml$/iu.test(name));
  return rootYamls.length === 1 ? rootYamls[0] : null;
}

export function utf8FromZip(data: Uint8Array): string {
  return strFromU8(data);
}

export function utf8ToZip(text: string): Uint8Array {
  return strToU8(text);
}

export function isZipBuffer(bytes: Uint8Array): boolean {
  return bytes.byteLength >= 4
    && bytes[0] === 0x50
    && bytes[1] === 0x4b
    && (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07)
    && (bytes[3] === 0x04 || bytes[3] === 0x06 || bytes[3] === 0x08);
}
