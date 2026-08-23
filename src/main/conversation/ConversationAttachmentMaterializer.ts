import * as fs from 'fs';
import * as path from 'path';
import type { AttachmentLayer, ConversationAttachmentInput } from '@shared/types/conversation';
import type { AgentRouteCapability } from '@shared/types/agentRuntime';
import type { SessionAttachmentKind, SessionAttachmentRecord } from '@shared/types/session';
import type { UserMessage } from '../agent-runtime/core/types';
import type { FrozenAttachmentManifestEntry } from '../workflow/debugger/orchestratorTypes';
import {
  MAX_ATTACHMENT_BYTES_PER_FILE,
  MAX_ATTACHMENT_COUNT,
  MAX_ATTACHMENT_TOTAL_BYTES,
  MAX_DECODED_IMAGE_BYTES,
  NATIVE_IMAGE_MIME_TYPES,
  assertSafeImageBytes,
  classifyAttachmentBytes,
  detectImageMagicMime,
  inferAttachmentMimeType,
} from './attachmentClassify';
import {
  extractPdfText,
  extractUtf8Text,
  resolveInlineTokenBudget,
} from './AttachmentTextExtractor';

export {
  MAX_ATTACHMENT_BYTES_PER_FILE,
  MAX_ATTACHMENT_COUNT,
  MAX_ATTACHMENT_TOTAL_BYTES,
  detectImageMagicMime,
};

export type AgentInputAttachment = {
  attachmentId?: string;
  kind: SessionAttachmentKind;
  layer: AttachmentLayer;
  fileName: string;
  filePath: string;
  readPath?: string;
  mimeType: string;
  size: number;
};

export interface MaterializedAgentUserInput {
  content: UserMessage['content'];
  imageTokenAdjustment: number;
  inlineTokenBudget: number;
  attachmentManifest: FrozenAttachmentManifestEntry[];
}

export interface MaterializeAgentUserInputOptions {
  includeImageData?: boolean;
  contextBudgetTokens?: number;
  inlineTokenBudget?: number;
}

function sourcePathOf(attachment: AgentInputAttachment): string {
  return attachment.readPath ?? attachment.filePath;
}

export async function assertSafeImageAttachment(
  filePath: string,
  declaredMimeType: string,
  fileName: string,
): Promise<{ mimeType: string; size: number }> {
  if (declaredMimeType === 'image/svg+xml' || path.extname(filePath).toLowerCase() === '.svg') {
    throw new Error(`ATTACHMENT_MEDIA_UNSUPPORTED: ${fileName} (image/svg+xml)`);
  }
  if (!NATIVE_IMAGE_MIME_TYPES.has(declaredMimeType)) {
    throw new Error(`ATTACHMENT_MEDIA_UNSUPPORTED: ${fileName} (${declaredMimeType})`);
  }
  const handle = await fs.promises.open(filePath, 'r');
  try {
    const stats = await handle.stat();
    const probeSize = Math.min(stats.size, 256 * 1024);
    const probe = Buffer.alloc(probeSize);
    await handle.read(probe, 0, probeSize, 0);
    assertSafeImageBytes(fileName, declaredMimeType, probe);
    return { mimeType: declaredMimeType, size: stats.size };
  } finally {
    await handle.close();
  }
}

export async function resolvePendingAttachmentDescriptors(
  attachments: ConversationAttachmentInput[],
): Promise<AgentInputAttachment[]> {
  if (attachments.length > MAX_ATTACHMENT_COUNT) {
    throw new Error(`ATTACHMENT_LIMIT_EXCEEDED: at most ${MAX_ATTACHMENT_COUNT} attachments are allowed.`);
  }
  const resolved: AgentInputAttachment[] = [];
  let totalBytes = 0;
  for (const attachment of attachments) {
    const filePath = path.resolve(attachment.sourcePath);
    const stats = await fs.promises.stat(filePath).catch(() => null);
    if (!stats?.isFile()) {
      throw new Error(`ATTACHMENT_NOT_FOUND: ${attachment.fileName || path.basename(filePath)}`);
    }
    if (stats.size > MAX_ATTACHMENT_BYTES_PER_FILE) {
      throw new Error(`ATTACHMENT_LIMIT_EXCEEDED: ${attachment.fileName || path.basename(filePath)} exceeds ${MAX_ATTACHMENT_BYTES_PER_FILE} bytes.`);
    }
    totalBytes += stats.size;
    if (totalBytes > MAX_ATTACHMENT_TOTAL_BYTES) {
      throw new Error(`ATTACHMENT_LIMIT_EXCEEDED: total attachment bytes exceed ${MAX_ATTACHMENT_TOTAL_BYTES}.`);
    }
    const fileName = attachment.fileName || path.basename(filePath);
    const header = Buffer.alloc(Math.min(stats.size, 64 * 1024));
    const handle = await fs.promises.open(filePath, 'r');
    try {
      await handle.read(header, 0, header.length, 0);
    } finally {
      await handle.close();
    }
    const classification = classifyAttachmentBytes(
      fileName,
      header,
      inferAttachmentMimeType(fileName, attachment.mimeType),
    );
    if (classification.rejectCode) {
      throw new Error(`${classification.rejectCode}: ${classification.rejectMessage ?? fileName}`);
    }
    if (classification.layer === 'image') {
      const checked = await assertSafeImageAttachment(filePath, classification.mimeType, fileName);
      resolved.push({
        kind: 'image',
        layer: 'image',
        fileName,
        filePath,
        mimeType: checked.mimeType,
        size: checked.size,
      });
    } else {
      resolved.push({
        kind: 'file',
        layer: classification.layer,
        fileName,
        filePath,
        mimeType: classification.mimeType,
        size: stats.size,
      });
    }
  }
  return resolved;
}

export function imageTokenAdjustmentForContent(content: UserMessage['content']): number {
  if (typeof content === 'string') return 0;
  let extra = 0;
  for (const block of content) {
    if (block.type !== 'image') continue;
    const data = typeof block.data === 'string' ? block.data : '';
    if (!data) continue;
    extra += Math.max(256, Math.ceil(Math.max(0, Math.floor(data.length * 0.75)) / 1024)) - 256;
  }
  return extra;
}

function formatAttachmentLine(attachment: AgentInputAttachment): string {
  return `- ${attachment.fileName} (${attachment.layer}, ${attachment.mimeType}, ${attachment.size} bytes): ${attachment.filePath}`;
}

async function buildInlineSection(
  attachments: AgentInputAttachment[],
  budgetTokens: number,
): Promise<string> {
  const extractable = attachments.filter((attachment) => attachment.layer === 'text' || attachment.layer === 'pdf');
  if (extractable.length === 0) return '';
  const sections: string[] = [];
  for (const attachment of extractable) {
    const extracted = attachment.layer === 'pdf'
      ? await extractPdfText(sourcePathOf(attachment), budgetTokens)
      : await extractUtf8Text(sourcePathOf(attachment), budgetTokens);
    if (extracted.emptyReason) {
      sections.push(
        `### ${attachment.fileName}\n${extracted.emptyReason}\nFull file at ${attachment.filePath}`,
      );
      continue;
    }
    const fence = attachment.mimeType === 'application/json' ? 'json' : '';
    const truncation = extracted.truncated
      ? `\n… truncated, showing ${extracted.extractedBytes} of ${extracted.totalBytes} bytes, full file at ${attachment.filePath}`
      : '';
    sections.push(
      `### ${attachment.fileName}\n\`\`\`${fence}\n${extracted.body}\n\`\`\`${truncation}`,
    );
  }
  return `\n\nAttachment contents:\n${sections.join('\n\n')}`;
}

function toManifestEntry(attachment: AgentInputAttachment, index: number): FrozenAttachmentManifestEntry {
  return {
    attachmentId: attachment.attachmentId ?? `att_prepare_${index}`,
    fileName: attachment.fileName,
    filePath: attachment.filePath,
    mimeType: attachment.mimeType,
    size: attachment.size,
    layer: attachment.layer,
    kind: attachment.kind,
  };
}

function normalizeOptions(
  options?: boolean | MaterializeAgentUserInputOptions,
): MaterializeAgentUserInputOptions {
  if (typeof options === 'boolean') return { includeImageData: options };
  return options ?? {};
}

export async function materializeAgentUserInput(
  message: string,
  attachments: AgentInputAttachment[],
  visionInputMode: AgentRouteCapability['visionInputMode'],
  options?: boolean | MaterializeAgentUserInputOptions,
): Promise<MaterializedAgentUserInput> {
  const resolved = normalizeOptions(options);
  if (attachments.length === 0) {
    return { content: message, imageTokenAdjustment: 0, inlineTokenBudget: 0, attachmentManifest: [] };
  }
  if (attachments.length > MAX_ATTACHMENT_COUNT) {
    throw new Error(`ATTACHMENT_LIMIT_EXCEEDED: at most ${MAX_ATTACHMENT_COUNT} attachments are allowed.`);
  }
  if (attachments.some((attachment) => !attachment.layer)) {
    throw new Error('ATTACHMENT_INVALID: attachment layer is required.');
  }
  let totalBytes = 0;
  for (const attachment of attachments) {
    const sourcePath = sourcePathOf(attachment);
    const stats = await fs.promises.stat(sourcePath).catch(() => null);
    const actualSize = stats?.isFile() ? stats.size : attachment.size;
    if (!Number.isFinite(actualSize) || actualSize < 0 || actualSize > MAX_ATTACHMENT_BYTES_PER_FILE) {
      throw new Error(`ATTACHMENT_LIMIT_EXCEEDED: ${attachment.fileName} exceeds the per-file byte limit.`);
    }
    totalBytes += actualSize;
    if (totalBytes > MAX_ATTACHMENT_TOTAL_BYTES) {
      throw new Error(`ATTACHMENT_LIMIT_EXCEEDED: total attachment bytes exceed ${MAX_ATTACHMENT_TOTAL_BYTES}.`);
    }
  }

  const imageAttachments = attachments.filter((attachment) => attachment.layer === 'image');
  if (imageAttachments.length > 0 && visionInputMode !== 'native') {
    throw new Error('VISION_INPUT_UNSUPPORTED: the selected model route does not accept image attachments.');
  }
  for (const attachment of imageAttachments) {
    if (!NATIVE_IMAGE_MIME_TYPES.has(attachment.mimeType)) {
      throw new Error(`ATTACHMENT_MEDIA_UNSUPPORTED: ${attachment.fileName} (${attachment.mimeType})`);
    }
    const sourcePath = sourcePathOf(attachment);
    const exists = await fs.promises.stat(sourcePath).then((stats) => stats.isFile()).catch(() => false);
    if (exists) {
      await assertSafeImageAttachment(sourcePath, attachment.mimeType, attachment.fileName);
    } else if (resolved.includeImageData) {
      throw new Error(`ATTACHMENT_NOT_FOUND: ${attachment.fileName}`);
    }
  }

  const extractableCount = attachments.filter((attachment) => (
    attachment.layer === 'text' || attachment.layer === 'pdf'
  )).length;
  const inlineTokenBudget = resolved.inlineTokenBudget
    ?? resolveInlineTokenBudget(extractableCount, resolved.contextBudgetTokens);
  const summary = attachments.map(formatAttachmentLine).join('\n');
  const inline = await buildInlineSection(attachments, inlineTokenBudget);
  const content: Extract<UserMessage['content'], unknown[]> = [{
    type: 'text',
    text: `${message}\n\nAttachments available in this request:\n${summary}${inline}`,
  }];
  let imageTokenAdjustment = 0;
  const imageData = new Map<string, string>();
  if (resolved.includeImageData) {
    for (const attachment of imageAttachments) {
      const bytes = await fs.promises.readFile(sourcePathOf(attachment));
      if (bytes.byteLength > MAX_DECODED_IMAGE_BYTES) {
        throw new Error(`ATTACHMENT_LIMIT_EXCEEDED: decoded image ${attachment.fileName} exceeds ${MAX_DECODED_IMAGE_BYTES} bytes.`);
      }
      imageData.set(attachment.filePath, bytes.toString('base64'));
    }
  }
  for (const attachment of imageAttachments) {
    content.push({
      type: 'image',
      data: resolved.includeImageData ? (imageData.get(attachment.filePath) ?? '') : '',
      mimeType: attachment.mimeType,
    });
    imageTokenAdjustment += Math.max(256, Math.ceil(attachment.size / 1024)) - 256;
  }
  return {
    content,
    imageTokenAdjustment,
    inlineTokenBudget,
    attachmentManifest: attachments.map(toManifestEntry),
  };
}

function sameManifestEntry(
  expected: FrozenAttachmentManifestEntry,
  actual: SessionAttachmentRecord,
): boolean {
  return expected.attachmentId === actual.attachmentId
    && expected.fileName === actual.fileName
    && expected.filePath === actual.filePath
    && expected.mimeType === actual.mimeType
    && expected.size === actual.size
    && expected.layer === actual.layer
    && expected.kind === actual.kind;
}

export async function hydrateFrozenUserContent(
  frozen: UserMessage['content'],
  manifest: FrozenAttachmentManifestEntry[],
  importedAttachments: SessionAttachmentRecord[],
): Promise<UserMessage['content']> {
  if (manifest.length !== importedAttachments.length) {
    throw new Error('ATTACHMENT_INVALID: frozen attachment manifest length does not match committed attachments.');
  }
  for (let index = 0; index < manifest.length; index += 1) {
    const expected = manifest[index]!;
    const actual = importedAttachments[index]!;
    if (!sameManifestEntry(expected, actual)) {
      throw new Error(`ATTACHMENT_INVALID: frozen attachment manifest mismatch for ${expected.fileName}.`);
    }
  }
  if (typeof frozen === 'string') return frozen;
  const imageByPath = new Map<string, string>();
  for (const entry of manifest) {
    if (entry.layer !== 'image') continue;
    const exists = await fs.promises.stat(entry.filePath).then((stats) => stats.isFile()).catch(() => false);
    if (!exists) {
      throw new Error(`ATTACHMENT_NOT_FOUND: ${entry.fileName}`);
    }
    await assertSafeImageAttachment(entry.filePath, entry.mimeType, entry.fileName);
    const bytes = await fs.promises.readFile(entry.filePath);
    if (bytes.byteLength > MAX_DECODED_IMAGE_BYTES) {
      throw new Error(`ATTACHMENT_LIMIT_EXCEEDED: decoded image ${entry.fileName} exceeds ${MAX_DECODED_IMAGE_BYTES} bytes.`);
    }
    imageByPath.set(entry.filePath, bytes.toString('base64'));
  }
  let imageIndex = 0;
  const imageEntries = manifest.filter((entry) => entry.layer === 'image');
  return frozen.map((block) => {
    if (block.type !== 'image') return block;
    const entry = imageEntries[imageIndex];
    imageIndex += 1;
    if (!entry) {
      throw new Error('ATTACHMENT_INVALID: frozen image block has no matching manifest entry.');
    }
    return {
      ...block,
      data: imageByPath.get(entry.filePath) ?? '',
      mimeType: entry.mimeType,
    };
  });
}

export function attachmentManifestFingerprintOf(
  manifest: FrozenAttachmentManifestEntry[],
): string {
  return JSON.stringify(manifest.map((entry) => ({
    attachmentId: entry.attachmentId,
    fileName: entry.fileName,
    filePath: entry.filePath,
    mimeType: entry.mimeType,
    size: entry.size,
    layer: entry.layer,
    kind: entry.kind,
  })));
}
