import * as fs from 'fs';
import * as path from 'path';
import type { ConversationAttachmentInput } from '@shared/types/conversation';
import type { AgentRouteCapability } from '@shared/types/agentRuntime';
import type { SessionAttachmentRecord } from '@shared/types/session';
import type { UserMessage } from '../agent-runtime/core/types';

export type AgentInputAttachment = Pick<
  SessionAttachmentRecord,
  'kind' | 'fileName' | 'filePath' | 'mimeType' | 'size'
>;

export interface MaterializedAgentUserInput {
  content: UserMessage['content'];
  imageTokenAdjustment: number;
}

const NATIVE_IMAGE_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
]);

const MAX_IMAGE_PIXELS = 40_000_000;
const MAX_IMAGE_EDGE = 16_384;

function inferAttachmentMimeType(filePath: string, declaredMimeType?: string | null): string {
  const declared = declaredMimeType?.trim().toLowerCase();
  if (declared) return declared;
  switch (path.extname(filePath).toLowerCase()) {
    case '.png': return 'image/png';
    case '.jpg':
    case '.jpeg': return 'image/jpeg';
    case '.gif': return 'image/gif';
    case '.webp': return 'image/webp';
    case '.svg': return 'image/svg+xml';
    case '.bmp': return 'image/bmp';
    case '.json': return 'application/json';
    case '.txt':
    case '.md': return 'text/plain';
    default: return 'application/octet-stream';
  }
}

/** Detect image MIME from magic bytes. Returns null when unrecognized. */
export function detectImageMagicMime(header: Buffer): string | null {
  if (header.length >= 8
    && header[0] === 0x89 && header[1] === 0x50 && header[2] === 0x4e && header[3] === 0x47
    && header[4] === 0x0d && header[5] === 0x0a && header[6] === 0x1a && header[7] === 0x0a) {
    return 'image/png';
  }
  if (header.length >= 3 && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff) {
    return 'image/jpeg';
  }
  if (header.length >= 6) {
    const sig = header.subarray(0, 6).toString('ascii');
    if (sig === 'GIF87a' || sig === 'GIF89a') return 'image/gif';
  }
  if (header.length >= 12
    && header.subarray(0, 4).toString('ascii') === 'RIFF'
    && header.subarray(8, 12).toString('ascii') === 'WEBP') {
    return 'image/webp';
  }
  // SVG is text — treat leading `<svg` / `<?xml` as svg for rejection path.
  const headText = header.subarray(0, Math.min(header.length, 256)).toString('utf8').trimStart().toLowerCase();
  if (headText.startsWith('<svg') || (headText.startsWith('<?xml') && headText.includes('<svg'))) {
    return 'image/svg+xml';
  }
  return null;
}

function readImageDimensions(mimeType: string, bytes: Buffer): { width: number; height: number } | null {
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
        const width = 1 + bytes.readUIntLE(24, 3);
        const height = 1 + bytes.readUIntLE(27, 3);
        return { width, height };
      }
      if (chunk === 'VP8 ' && bytes.length >= 30) {
        const width = bytes.readUInt16LE(26) & 0x3fff;
        const height = bytes.readUInt16LE(28) & 0x3fff;
        return { width, height };
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
          return {
            height: bytes.readUInt16BE(offset + 5),
            width: bytes.readUInt16BE(offset + 7),
          };
        }
        offset += 2 + length;
      }
    }
  } catch {
    return null;
  }
  return null;
}

function assertSvgHasNoScript(bytes: Buffer): void {
  const text = bytes.toString('utf8');
  if (/<script[\s>]/i.test(text) || /\bon\w+\s*=/i.test(text) || /javascript:/i.test(text)) {
    throw new Error('ATTACHMENT_MEDIA_UNSUPPORTED: SVG scripts and event handlers are blocked');
  }
}

export async function assertSafeImageAttachment(
  filePath: string,
  declaredMimeType: string,
  fileName: string,
): Promise<{ mimeType: string; size: number }> {
  if (declaredMimeType === 'image/svg+xml' || path.extname(filePath).toLowerCase() === '.svg') {
    // SVG is never accepted as native vision input; scan scripts when the file exists.
    try {
      const bytes = await fs.promises.readFile(filePath);
      assertSvgHasNoScript(bytes);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('ATTACHMENT_MEDIA_UNSUPPORTED')) {
        throw error;
      }
      // Missing/unreadable SVG still fails closed as unsupported media.
    }
    throw new Error(`ATTACHMENT_MEDIA_UNSUPPORTED: ${fileName} (image/svg+xml)`);
  }
  if (!NATIVE_IMAGE_MIME_TYPES.has(declaredMimeType)) {
    throw new Error(`ATTACHMENT_MEDIA_UNSUPPORTED: ${fileName} (${declaredMimeType})`);
  }
  const handle = await fs.promises.open(filePath, 'r');
  try {
    const header = Buffer.alloc(64);
    const { bytesRead } = await handle.read(header, 0, 64, 0);
    const magicMime = detectImageMagicMime(header.subarray(0, bytesRead));
    if (!magicMime) {
      throw new Error(`ATTACHMENT_INVALID: ${fileName} magic bytes do not match a supported image`);
    }
    if (magicMime === 'image/svg+xml') {
      throw new Error(`ATTACHMENT_MEDIA_UNSUPPORTED: ${fileName} (image/svg+xml)`);
    }
    if (magicMime !== declaredMimeType) {
      throw new Error(
        `ATTACHMENT_INVALID: ${fileName} declared ${declaredMimeType} but content is ${magicMime}`,
      );
    }
    const stats = await handle.stat();
    // Read enough of the file for dimension headers (JPEG SOF may be deeper).
    const probeSize = Math.min(stats.size, 256 * 1024);
    const probe = Buffer.alloc(probeSize);
    await handle.read(probe, 0, probeSize, 0);
    const dims = readImageDimensions(magicMime, probe);
    if (dims) {
      if (dims.width > MAX_IMAGE_EDGE || dims.height > MAX_IMAGE_EDGE) {
        throw new Error(
          `ATTACHMENT_INVALID: ${fileName} edge ${dims.width}x${dims.height} exceeds ${MAX_IMAGE_EDGE}`,
        );
      }
      if (dims.width * dims.height > MAX_IMAGE_PIXELS) {
        throw new Error(
          `ATTACHMENT_INVALID: ${fileName} pixels ${dims.width * dims.height} exceed ${MAX_IMAGE_PIXELS}`,
        );
      }
    }
    return { mimeType: magicMime, size: stats.size };
  } finally {
    await handle.close();
  }
}

export async function resolvePendingAttachmentDescriptors(
  attachments: ConversationAttachmentInput[],
): Promise<AgentInputAttachment[]> {
  return Promise.all(attachments.map(async (attachment) => {
    const filePath = path.resolve(attachment.sourcePath);
    const stats = await fs.promises.stat(filePath).catch(() => null);
    if (!stats?.isFile()) {
      throw new Error(`ATTACHMENT_NOT_FOUND: ${attachment.fileName || path.basename(filePath)}`);
    }
    const mimeType = inferAttachmentMimeType(filePath, attachment.mimeType);
    if (mimeType.startsWith('image/')) {
      const checked = await assertSafeImageAttachment(
        filePath,
        mimeType,
        attachment.fileName || path.basename(filePath),
      );
      return {
        kind: 'image' as const,
        fileName: attachment.fileName || path.basename(filePath),
        filePath,
        mimeType: checked.mimeType,
        size: checked.size,
      };
    }
    return {
      kind: 'file' as const,
      fileName: attachment.fileName || path.basename(filePath),
      filePath,
      mimeType,
      size: stats.size,
    };
  }));
}

export async function materializeAgentUserInput(
  message: string,
  attachments: AgentInputAttachment[],
  visionInputMode: AgentRouteCapability['visionInputMode'],
  includeImageData: boolean,
): Promise<MaterializedAgentUserInput> {
  if (attachments.length === 0) {
    return { content: message, imageTokenAdjustment: 0 };
  }

  const imageAttachments = attachments.filter((attachment) => attachment.kind === 'image');
  if (imageAttachments.length > 0 && visionInputMode !== 'native') {
    throw new Error('VISION_INPUT_UNSUPPORTED: the selected model route does not accept image attachments.');
  }
  for (const attachment of imageAttachments) {
    if (!NATIVE_IMAGE_MIME_TYPES.has(attachment.mimeType)) {
      throw new Error(`ATTACHMENT_MEDIA_UNSUPPORTED: ${attachment.fileName} (${attachment.mimeType})`);
    }
    const exists = await fs.promises.stat(attachment.filePath).then((stats) => stats.isFile()).catch(() => false);
    if (exists) {
      await assertSafeImageAttachment(attachment.filePath, attachment.mimeType, attachment.fileName);
    } else if (includeImageData) {
      throw new Error(`ATTACHMENT_NOT_FOUND: ${attachment.fileName}`);
    }
  }

  const attachmentSummary = attachments
    .map((attachment) => (
      `- ${attachment.fileName} (${attachment.mimeType}, ${attachment.size} bytes): ${attachment.filePath}`
    ))
    .join('\n');
  const content: Extract<UserMessage['content'], unknown[]> = [{
    type: 'text',
    text: `${message}\n\nAttachments available in this request:\n${attachmentSummary}`,
  }];
  let imageTokenAdjustment = 0;
  for (const attachment of imageAttachments) {
    content.push({
      type: 'image',
      data: includeImageData
        ? (await fs.promises.readFile(attachment.filePath)).toString('base64')
        : '',
      mimeType: attachment.mimeType,
    });
    imageTokenAdjustment += Math.max(256, Math.ceil(attachment.size / 1024)) - 256;
  }
  return { content, imageTokenAdjustment };
}
