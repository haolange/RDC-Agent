import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type {
  AttachmentRejectCode,
  ComposerAttachmentDescriptor,
  ConversationAttachmentStageItem,
} from '@shared/types/conversation';
import { appPathService } from '../runtime/AppPathService';
import {
  MAX_ATTACHMENT_BYTES_PER_FILE,
  MAX_ATTACHMENT_COUNT,
  MAX_ATTACHMENT_TOTAL_BYTES,
  assertSafeImageBytes,
  classifyAttachmentBytes,
} from './attachmentClassify';
import { createCardThumbnail, toDataUrl } from './attachmentPreview';

export interface StagedAttachmentRecord {
  descriptor: ComposerAttachmentDescriptor;
  bytesPath: string;
  previewPath?: string;
  composerScopeKey: string;
  createdAt: number;
  size: number;
}

const PREVIEW_ID_RE = /^[a-f0-9]{16,64}$/;
const WINDOWS_RESERVED_NAMES = new Set([
  'CON', 'PRN', 'AUX', 'NUL',
  'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
  'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9',
]);
const MAX_STAGED_ITEMS = 64;
const MAX_STAGED_BYTES = 256 * 1024 * 1024;
const STAGING_TTL_MS = 2 * 60 * 60 * 1000;
const STRICT_BASE64_RE = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

function isPathItem(item: ConversationAttachmentStageItem): item is { sourcePath: string; fileName?: string } {
  return 'sourcePath' in item && typeof item.sourcePath === 'string';
}

export function sanitizeFileName(fileName: string): string {
  const stripped = path.basename(fileName)
    .replace(/[. ]+$/u, '')
    .split('')
    .map((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || '<>:"|?*'.includes(character) ? '_' : character;
    })
    .join('')
    .trim();
  const stem = path.parse(stripped).name.toUpperCase();
  if (!stripped || stripped === '.' || stripped === '..' || WINDOWS_RESERVED_NAMES.has(stem)) {
    throw new Error('ATTACHMENT_INVALID: file name is reserved or empty.');
  }
  return stripped.slice(0, 240);
}

export function decodeStrictBase64(value: string): Buffer {
  const compact = value.replace(/\s+/g, '');
  if (!STRICT_BASE64_RE.test(compact)) {
    throw new Error('ATTACHMENT_INVALID: attachment bytes are not valid base64.');
  }
  const decoded = Buffer.from(compact, 'base64');
  if (decoded.toString('base64').replace(/=+$/u, '') !== compact.replace(/=+$/u, '')) {
    throw new Error('ATTACHMENT_INVALID: attachment bytes are not valid base64.');
  }
  return decoded;
}

function assertInsideRoot(rootPath: string, candidatePath: string): string {
  const resolvedRoot = fs.realpathSync(path.resolve(rootPath));
  const resolvedFile = fs.realpathSync(path.resolve(candidatePath));
  const relative = path.relative(resolvedRoot, resolvedFile);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('ATTACHMENT_INVALID: staged path escaped the staging directory.');
  }
  return resolvedFile;
}

export class AttachmentStagingService {
  private readonly records = new Map<string, StagedAttachmentRecord>();

  stagingRoot(): string {
    return appPathService.getAppStatePaths().attachmentStagingPath;
  }

  clearAll(): void {
    this.records.clear();
    const root = this.stagingRoot();
    fs.rmSync(root, { recursive: true, force: true });
    fs.mkdirSync(root, { recursive: true });
  }

  get(stagingId: string): StagedAttachmentRecord | undefined {
    this.sweepExpired();
    return this.records.get(stagingId);
  }

  getByPreviewId(previewId: string, composerScopeKey?: string): StagedAttachmentRecord | undefined {
    if (!PREVIEW_ID_RE.test(previewId)) return undefined;
    this.sweepExpired();
    const record = this.records.get(previewId);
    if (!record) return undefined;
    if (composerScopeKey && record.composerScopeKey !== composerScopeKey) return undefined;
    return record;
  }

  async stage(
    items: readonly ConversationAttachmentStageItem[],
    composerScopeKey: string,
  ): Promise<ComposerAttachmentDescriptor[]> {
    this.sweepExpired();
    if (items.length > MAX_ATTACHMENT_COUNT) {
      throw new Error(`ATTACHMENT_LIMIT_EXCEEDED: at most ${MAX_ATTACHMENT_COUNT} attachments are allowed.`);
    }
    if (this.records.size + items.length > MAX_STAGED_ITEMS) {
      throw new Error(`ATTACHMENT_LIMIT_EXCEEDED: at most ${MAX_STAGED_ITEMS} staged attachments are allowed.`);
    }
    fs.mkdirSync(this.stagingRoot(), { recursive: true });
    const descriptors: ComposerAttachmentDescriptor[] = [];
    for (const item of items) {
      descriptors.push(await this.stageOne(item, composerScopeKey));
    }
    return descriptors;
  }

  release(stagingIds: readonly string[]): string[] {
    const released: string[] = [];
    for (const stagingId of stagingIds) {
      if (this.removeRecord(stagingId)) released.push(stagingId);
    }
    return released;
  }

  releaseByComposerScope(composerScopeKey: string): string[] {
    return this.release(
      [...this.records.values()]
        .filter((record) => record.composerScopeKey === composerScopeKey)
        .map((record) => record.descriptor.stagingId),
    );
  }

  releaseBySessionId(sessionId: string): string[] {
    return this.release(
      [...this.records.values()]
        .filter((record) => (
          record.composerScopeKey === sessionId
          || record.composerScopeKey.endsWith(`:${sessionId}`)
        ))
        .map((record) => record.descriptor.stagingId),
    );
  }

  readPreviewDataUrl(previewId: string, composerScopeKey?: string): string | null {
    const record = this.getByPreviewId(previewId, composerScopeKey);
    if (!record?.previewPath || !fs.existsSync(record.previewPath)) return null;
    const bytes = fs.readFileSync(record.previewPath);
    return toDataUrl(bytes, 'image/png');
  }

  private sweepExpired(): void {
    const now = Date.now();
    for (const [stagingId, record] of this.records) {
      if (now - record.createdAt > STAGING_TTL_MS) this.removeRecord(stagingId);
    }
  }

  private currentQuota(): { count: number; bytes: number } {
    let bytes = 0;
    for (const record of this.records.values()) bytes += record.size;
    return { count: this.records.size, bytes };
  }

  private removeRecord(stagingId: string): boolean {
    const record = this.records.get(stagingId);
    if (!record) return false;
    this.records.delete(stagingId);
    fs.rmSync(path.join(this.stagingRoot(), stagingId), { recursive: true, force: true });
    return true;
  }

  private async stageOne(
    item: ConversationAttachmentStageItem,
    composerScopeKey: string,
  ): Promise<ComposerAttachmentDescriptor> {
    const stagingId = crypto.randomBytes(16).toString('hex');
    let fileName: string;
    try {
      fileName = sanitizeFileName(isPathItem(item)
        ? (item.fileName || path.basename(item.sourcePath))
        : item.fileName);
    } catch (error) {
      return this.reject(
        stagingId,
        isPathItem(item) ? (item.fileName || 'attachment.bin') : item.fileName,
        'ATTACHMENT_INVALID',
        error instanceof Error ? error.message.replace(/^ATTACHMENT_INVALID:\s*/u, '') : 'Invalid file name.',
      );
    }
    const loaded = await this.readItemBytes(item, fileName);
    if (loaded.error) {
      return this.reject(stagingId, fileName, loaded.error.code, loaded.error.message);
    }
    const { bytes, declaredMime } = loaded;
    const quota = this.currentQuota();
    if (quota.bytes + bytes.byteLength > MAX_STAGED_BYTES) {
      return this.reject(
        stagingId,
        fileName,
        'ATTACHMENT_LIMIT_EXCEEDED',
        `Staged attachments exceed ${MAX_STAGED_BYTES} bytes.`,
      );
    }
    if (bytes.byteLength > MAX_ATTACHMENT_BYTES_PER_FILE) {
      return this.reject(
        stagingId,
        fileName,
        'ATTACHMENT_LIMIT_EXCEEDED',
        `${fileName} exceeds ${MAX_ATTACHMENT_BYTES_PER_FILE} bytes.`,
      );
    }
    const classification = classifyAttachmentBytes(fileName, bytes, declaredMime);
    if (classification.rejectCode) {
      return this.reject(stagingId, fileName, classification.rejectCode, classification.rejectMessage ?? classification.rejectCode);
    }
    const dir = path.join(this.stagingRoot(), stagingId);
    fs.mkdirSync(dir, { recursive: true });
    const bytesPath = path.join(dir, fileName);
    fs.writeFileSync(bytesPath, bytes);
    assertInsideRoot(dir, bytesPath);
    let previewId: string | undefined;
    let previewPath: string | undefined;
    if (classification.layer === 'image') {
      try {
        assertSafeImageBytes(fileName, classification.mimeType, bytes);
        const thumb = createCardThumbnail(bytes, classification.mimeType);
        previewId = stagingId;
        previewPath = path.join(dir, 'preview.png');
        fs.writeFileSync(previewPath, thumb.data);
      } catch (error) {
        fs.rmSync(dir, { recursive: true, force: true });
        return this.reject(
          stagingId,
          fileName,
          'ATTACHMENT_INVALID',
          error instanceof Error ? error.message.replace(/^ATTACHMENT_[A-Z_]+:\s*/u, '') : 'Unsafe image.',
        );
      }
    }
    const descriptor: ComposerAttachmentDescriptor = {
      stagingId,
      fileName,
      mimeType: classification.mimeType,
      size: bytes.byteLength,
      layer: classification.layer,
      kind: classification.kind,
      sourcePath: bytesPath,
      ...(previewId ? { previewId } : {}),
    };
    this.records.set(stagingId, {
      descriptor,
      bytesPath,
      previewPath,
      composerScopeKey,
      createdAt: Date.now(),
      size: bytes.byteLength,
    });
    return descriptor;
  }

  private async readItemBytes(
    item: ConversationAttachmentStageItem,
    fileName: string,
  ): Promise<{
    bytes: Buffer;
    declaredMime?: string | null;
    error?: { code: AttachmentRejectCode; message: string };
  }> {
    if (isPathItem(item)) {
      const sourcePath = path.resolve(item.sourcePath);
      const stats = await fs.promises.stat(sourcePath).catch(() => null);
      if (!stats?.isFile()) {
        return { bytes: Buffer.alloc(0), error: { code: 'ATTACHMENT_NOT_FOUND', message: `${fileName} was not found.` } };
      }
      if (stats.size > MAX_ATTACHMENT_BYTES_PER_FILE) {
        return {
          bytes: Buffer.alloc(0),
          error: {
            code: 'ATTACHMENT_LIMIT_EXCEEDED',
            message: `${fileName} exceeds ${MAX_ATTACHMENT_BYTES_PER_FILE} bytes.`,
          },
        };
      }
      const bytes = await fs.promises.readFile(sourcePath);
      return { bytes };
    }
    try {
      const bytes = decodeStrictBase64(item.bytesBase64);
      if (bytes.byteLength > MAX_ATTACHMENT_TOTAL_BYTES) {
        return {
          bytes: Buffer.alloc(0),
          error: {
            code: 'ATTACHMENT_LIMIT_EXCEEDED',
            message: `${fileName} exceeds ${MAX_ATTACHMENT_BYTES_PER_FILE} bytes.`,
          },
        };
      }
      return { bytes, declaredMime: item.mimeType };
    } catch {
      return { bytes: Buffer.alloc(0), error: { code: 'ATTACHMENT_INVALID', message: `${fileName} is not valid base64.` } };
    }
  }

  private reject(
    stagingId: string,
    fileName: string,
    code: AttachmentRejectCode,
    message: string,
  ): ComposerAttachmentDescriptor {
    return {
      stagingId,
      fileName,
      mimeType: 'application/octet-stream',
      size: 0,
      layer: 'binary',
      kind: 'file',
      sourcePath: '',
      error: { code, message },
    };
  }
}

export const attachmentStagingService = new AttachmentStagingService();
