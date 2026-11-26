import { unzipSync } from 'fflate';

const CONTENT_TYPES = '[Content_Types].xml';
const ROOT_RELATIONSHIPS = '_rels/.rels';
const MAX_METADATA_BYTES = 256 * 1024;
const MAX_PACKAGE_ENTRIES = 8192;
const OFFICE_DOCUMENT_RELATIONSHIP = new Set([
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument',
  'http://purl.oclc.org/ooxml/officeDocument/relationships/officeDocument',
]);
const documentParts: Readonly<Record<string, { name: string; contentType: string }>> = {
  '.docx': {
    name: 'word/document.xml',
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
  },
  '.xlsx': {
    name: 'xl/workbook.xml',
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml',
  },
  '.pptx': {
    name: 'ppt/presentation.xml',
    contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml',
  },
};

function attribute(tag: string, name: string): string | undefined {
  return new RegExp(`\\s${name}\\s*=\\s*(['"])([^'"]+)\\1`, 'u').exec(tag)?.[2];
}

/** Read the ZIP directory and only inflate the two bounded OPC metadata files. */
export function isOfficeDocument(bytes: Buffer, extension: string): boolean {
  const part = documentParts[extension];
  if (!part || bytes.length < 4 || bytes.readUInt32LE(0) !== 0x04034b50) return false;
  const entries = new Set<string>();
  try {
    const metadata = unzipSync(bytes, {
      filter: (file) => {
        const name = file.name.toLowerCase();
        if (
          entries.size >= MAX_PACKAGE_ENTRIES ||
          entries.has(name) ||
          /[\\:\0]/u.test(name) ||
          name.startsWith('/') ||
          name.split('/').includes('..') ||
          /(?:^|\/)(?:activex|embeddings|vbaproject[^/]*)(?:\/|$)/u.test(name)
        ) {
          throw new Error('Unsafe Office package entry');
        }
        entries.add(name);
        return (
          (file.name === CONTENT_TYPES || file.name === ROOT_RELATIONSHIPS) &&
          file.originalSize <= MAX_METADATA_BYTES &&
          file.size <= MAX_METADATA_BYTES
        );
      },
    });
    const manifest = metadata[CONTENT_TYPES];
    const relationships = metadata[ROOT_RELATIONSHIPS];
    if (!manifest?.length || !relationships?.length || !entries.has(part.name)) return false;
    const decoder = new TextDecoder('utf-8', { fatal: true });
    const xml = decoder.decode(manifest);
    const rels = decoder.decode(relationships);
    if (/<!|macroenabled|vbaproject|activex|oleobject/iu.test(xml) || /<!/u.test(rels)) return false;
    const declaresMainPart = Array.from(xml.matchAll(/<(?:[\w.-]+:)?Override\b[^<>]*>/gu)).some(
      ([tag]) => attribute(tag, 'PartName') === `/${part.name}` && attribute(tag, 'ContentType') === part.contentType,
    );
    const linksMainPart = Array.from(rels.matchAll(/<(?:[\w.-]+:)?Relationship\b[^<>]*>/gu)).some(([tag]) => {
      const mode = attribute(tag, 'TargetMode');
      return (
        (!mode || mode === 'Internal') &&
        OFFICE_DOCUMENT_RELATIONSHIP.has(attribute(tag, 'Type') ?? '') &&
        attribute(tag, 'Target')?.replace(/^\//u, '') === part.name
      );
    });
    return declaresMainPart && linksMainPart;
  } catch {
    return false;
  }
}
