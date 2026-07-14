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
    return {
      kind: mimeType.startsWith('image/') ? 'image' : 'file',
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
