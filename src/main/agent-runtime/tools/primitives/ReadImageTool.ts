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
    'Read an image (png/jpeg/gif/webp) from the workspace or frozen Knowledge read scope for vision-capable routes. For declared Knowledge images, use knowledge_read readImageArgs exactly; its relative declarations are not workspace paths. Returns the SHA-256 of exact image-block bytes. Non-vision routes and paths outside the effective read scope fail closed.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Workspace-relative path, or absolute path inside the workspace or frozen Knowledge read scope. Use returned readImageArgs for Knowledge images; do not guess a knowledge root.' },
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
