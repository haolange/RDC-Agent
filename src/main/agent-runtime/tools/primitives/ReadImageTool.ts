import * as fs from 'fs/promises';
import * as path from 'path';
import { createHash } from 'node:crypto';
import type { AgentTool } from '../../agent/AgentTool';
import { safeResolvePath } from './_shared';
import { assertSafeImageAttachment } from '../../../conversation/ConversationAttachmentMaterializer';
import { recordToolImagePreview } from '../../../conversation/ToolImagePreviewStore';

interface ReadImageParams {
  path: string;
}

interface ReadImageDetails {
  path: string;
  mimeType: string;
  bytes: number;
  sha256: string;
  imagePreviews?: Array<{
    previewId: string;
    fileName: string;
    mimeType: string;
    width?: number;
    height?: number;
  }>;
}

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

export const readImageTool: AgentTool<ReadImageParams, ReadImageDetails> = {
  name: 'read_image',
  label: '查看图片',
  description:
    'Read a workspace image (png/jpeg/gif/webp) for vision-capable routes. Returns the SHA-256 of the exact file bytes delivered as the image block. Non-vision routes fail closed.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Relative or absolute image path inside the workspace.' },
    },
    required: ['path'],
  },
  spec: {
    isReadOnly: true,
    isConcurrencySafe: true,
    isDestructive: false,
    sideEffect: 'none',
    category: 'file',
    requiresApproval: false,
  },
  permissionHint: 'readonly',

  async execute(toolCallId, params, signal, _onUpdate, context) {
    if (signal?.aborted) throw new Error('Aborted');
    if (context?.visionInputMode !== 'native') {
      throw new Error('VISION_INPUT_UNSUPPORTED: the selected model route does not accept image attachments.');
    }
    const absolute = safeResolvePath(params.path, undefined, context);
    const fileName = path.basename(absolute);
    const extension = path.extname(absolute).toLowerCase();
    const mimeType = extension ? MIME_BY_EXT[extension] ?? 'application/octet-stream' : null;
    const checked = await assertSafeImageAttachment(absolute, mimeType, fileName);
    const bytes = await fs.readFile(absolute);
    if (signal?.aborted) throw new Error('Aborted');
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const imagePreviews = context.sessionId
      ? [await recordToolImagePreview({
          sessionId: context.sessionId,
          toolCallId,
          fileName,
          bytes,
          mimeType: checked.mimeType,
        })]
      : [];
    return {
      content: [
        { type: 'text', text: `Viewed image ${fileName} (${checked.mimeType}, ${bytes.length} bytes) · sha256=${sha256}` },
        { type: 'image', data: bytes.toString('base64'), mimeType: checked.mimeType },
      ],
      details: {
        path: absolute,
        mimeType: checked.mimeType,
        bytes: bytes.length,
        sha256,
        imagePreviews,
      },
    };
  },
};
