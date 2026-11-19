import * as fs from 'fs/promises';
import * as path from 'path';
import { createHash } from 'node:crypto';
import { nativeImage } from 'electron';
import type { AgentTool } from '../../agent/AgentTool';
import { safeResolvePath } from './_shared';
import { assertSafeImageAttachment } from '../../../conversation/ConversationAttachmentMaterializer';
import { recordToolImagePreview } from '../../../conversation/ToolImagePreviewStore';

interface ReadImageParams {
  path: string;
  region?: { x: number; y: number; width: number; height: number };
}

interface ReadImageDetails {
  path: string;
  mimeType: string;
  bytes: number;
  sha256: string;
  source?: { sha256: string; mimeType: string; width: number; height: number; region: NonNullable<ReadImageParams['region']> };
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
    'Read an image (png/jpeg/gif/webp) from the workspace or frozen Knowledge read scope for vision-capable routes. Optionally read a rectangular region in source-image pixels, without writing a file. For declared Knowledge images, use knowledge_read readImageArgs exactly; its relative declarations are not workspace paths. Returns the SHA-256 of exact image-block bytes and, for a region, the source hash, dimensions and coordinates. Non-vision routes and paths outside the effective read scope fail closed.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Workspace-relative path, or absolute path inside the workspace or frozen Knowledge read scope. Use returned readImageArgs for Knowledge images; do not guess a knowledge root.' },
      region: { type: 'object', description: 'Optional source-image pixel rectangle; origin is top left.',
        properties: { x: { type: 'integer', minimum: 0 }, y: { type: 'integer', minimum: 0 },
          width: { type: 'integer', minimum: 1 }, height: { type: 'integer', minimum: 1 } },
        required: ['x', 'y', 'width', 'height'], additionalProperties: false },
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
    const sourceBytes = await fs.readFile(absolute);
    if (signal?.aborted) throw new Error('Aborted');
    let bytes: Buffer = sourceBytes;
    let outputMimeType = checked.mimeType;
    let outputFileName = fileName;
    let source: ReadImageDetails['source'];
    if (params.region) {
      const { x, y, width, height } = params.region;
      if (![x, y, width, height].every(Number.isSafeInteger) || x < 0 || y < 0 || width < 1 || height < 1) {
        throw new Error('IMAGE_REGION_INVALID: expected a positive in-bounds pixel rectangle.');
      }
      const image = nativeImage.createFromBuffer(sourceBytes);
      if (image.isEmpty()) throw new Error('IMAGE_REGION_INVALID: source image could not be decoded.');
      const size = image.getSize();
      if (x + width > size.width || y + height > size.height) throw new Error('IMAGE_REGION_INVALID: rectangle exceeds source dimensions.');
      const cropped = image.crop({ x, y, width, height });
      const croppedSize = cropped.getSize();
      if (cropped.isEmpty() || croppedSize.width !== width || croppedSize.height !== height) {
        throw new Error('IMAGE_REGION_INVALID: region could not be decoded at the requested dimensions.');
      }
      bytes = cropped.toPNG();
      outputMimeType = 'image/png';
      outputFileName = `${path.parse(fileName).name}-region.png`;
      source = { sha256: createHash('sha256').update(sourceBytes).digest('hex'), mimeType: checked.mimeType,
        width: size.width, height: size.height, region: { x, y, width, height } };
    }
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const imagePreviews = context.sessionId
      ? [await recordToolImagePreview({
          sessionId: context.sessionId,
          toolCallId,
          fileName: outputFileName,
          bytes,
          mimeType: outputMimeType,
        })]
      : [];
    return {
      content: [
        { type: 'text', text: `Viewed image ${outputFileName} (${outputMimeType}, ${bytes.length} bytes) · sha256=${sha256}${source ? ` · source sha256=${source.sha256} · source size=${source.width}x${source.height} · region=${JSON.stringify(source.region)}` : ''}` },
        { type: 'image', data: bytes.toString('base64'), mimeType: outputMimeType },
      ],
      details: {
        path: absolute,
        mimeType: outputMimeType,
        bytes: bytes.length,
        sha256,
        ...(source ? { source } : {}),
        imagePreviews,
      },
    };
  },
};
