import * as fs from 'fs/promises';
import * as path from 'path';
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
    'Read a workspace image (png/jpeg/gif/webp) for vision-capable routes. Non-vision routes fail closed.',
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
    const mimeType = MIME_BY_EXT[path.extname(absolute).toLowerCase()] ?? 'application/octet-stream';
    const checked = await assertSafeImageAttachment(absolute, mimeType, fileName);
    const bytes = await fs.readFile(absolute);
    const imagePreviews = context.sessionId
      ? [await recordToolImagePreview({
          sessionId: context.sessionId,
          toolCallId,
          fileName,
          sourcePath: absolute,
          mimeType: checked.mimeType,
        })]
      : [];
    return {
      content: [
        { type: 'text', text: `Viewed image ${fileName} (${checked.mimeType}, ${checked.size} bytes)` },
        { type: 'image', data: bytes.toString('base64'), mimeType: checked.mimeType },
      ],
      details: {
        path: absolute,
        mimeType: checked.mimeType,
        bytes: checked.size,
        imagePreviews,
      },
    };
  },
};
