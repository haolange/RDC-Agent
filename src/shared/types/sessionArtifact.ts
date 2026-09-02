/**
 * session:// Artifact 契约与配额。
 * Wave 2：grammar / category 闭集 / 配额数字的单一事实源。
 * investigation category 现由 InvestigationArtifactService 写入 rdc.investigation.v1 垂直记录。
 */

export const SESSION_ARTIFACT_SCHEME = 'session://';

export const SESSION_ARTIFACT_CATEGORIES = ['plans', 'investigation', 'tool-outputs'] as const;

export type SessionArtifactCategory = (typeof SESSION_ARTIFACT_CATEGORIES)[number];

export const SESSION_ARTIFACT_ROOT_DIR = 'session-artifacts';

/** 单文件上限。 */
export const SESSION_ARTIFACT_MAX_FILE_BYTES = 2 * 1024 * 1024;

/** artifact_read 返回窗：字节。 */
export const ARTIFACT_READ_MAX_OUTPUT_BYTES = 200 * 1024;

/** artifact_read 返回窗：行。 */
export const ARTIFACT_READ_MAX_OUTPUT_LINES = 2000;

/** 工具结果序列化后自动卸货阈值。 */
export const TOOL_RESULT_ARTIFACTIZE_THRESHOLD_BYTES = 32 * 1024;

/** 单个 session 下 session-artifacts 合计上限。 */
export const SESSION_ARTIFACT_MAX_SESSION_BYTES = 96 * 1024 * 1024;

/** tool-outputs 最多文件数。 */
export const SESSION_ARTIFACT_MAX_TOOL_OUTPUT_FILES = 256;

export const SESSION_ARTIFACT_ALLOWED_MIME_TYPES = [
  'text/plain',
  'text/markdown',
  'application/json',
  'text/csv',
  'text/yaml',
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
] as const;

export type SessionArtifactMimeType = (typeof SESSION_ARTIFACT_ALLOWED_MIME_TYPES)[number];

export const SESSION_ARTIFACT_ALLOWED_MIME_SET = new Set<string>(SESSION_ARTIFACT_ALLOWED_MIME_TYPES);

export const SESSION_ARTIFACT_ERROR_CODES = [
  'ARTIFACT_URI_INVALID',
  'ARTIFACT_CATEGORY_UNKNOWN',
  'ARTIFACT_SESSION_DENIED',
  'ARTIFACT_PATH_ESCAPE',
  'ARTIFACT_SYMLINK_REJECTED',
  'ARTIFACT_HARDLINK_REJECTED',
  'ARTIFACT_NOT_FOUND',
  'ARTIFACT_MIME_DENIED',
  'ARTIFACT_TOO_LARGE',
  'ARTIFACT_QUOTA_EXCEEDED',
  'ARTIFACT_HASH_MISMATCH',
  'ARTIFACT_WRITE_FAILED',
] as const;

export type SessionArtifactErrorCode = (typeof SESSION_ARTIFACT_ERROR_CODES)[number];

export class SessionArtifactError extends Error {
  readonly code: SessionArtifactErrorCode;

  constructor(code: SessionArtifactErrorCode, message?: string) {
    super(message ? `${code}: ${message}` : code);
    this.name = 'SessionArtifactError';
    this.code = code;
  }
}

export interface ParsedSessionArtifactUri {
  category: SessionArtifactCategory;
  relativePath: string;
}

export interface SessionArtifactSourceRef {
  toolName: string;
  toolCallId: string;
}

export interface SessionArtifactRefDetails {
  artifactized: true;
  ref: string;
  hash: string;
  summary: string;
  bytes?: number;
  mimeType?: string;
  owner: string;
  source: SessionArtifactSourceRef;
}

/** Canonical JSON envelope written for auto-artifactized tool outputs. */
export interface SessionArtifactizedEnvelope {
  owner: string;
  source: SessionArtifactSourceRef;
  hash: string;
  size: number;
  mime: string;
  content: unknown;
  details: unknown;
}

export function isSessionArtifactSourceRef(value: unknown): value is SessionArtifactSourceRef {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return typeof record.toolName === 'string' && record.toolName.length > 0
    && typeof record.toolCallId === 'string' && record.toolCallId.length > 0;
}

export function isSessionArtifactizedEnvelope(value: unknown): value is SessionArtifactizedEnvelope {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return typeof record.owner === 'string' && record.owner.length > 0
    && isSessionArtifactSourceRef(record.source)
    && typeof record.hash === 'string' && /^[a-f0-9]{64}$/i.test(record.hash)
    && typeof record.size === 'number' && Number.isFinite(record.size) && record.size >= 0
    && typeof record.mime === 'string' && record.mime.length > 0
    && 'content' in record
    && 'details' in record;
}

const CATEGORY_SET = new Set<string>(SESSION_ARTIFACT_CATEGORIES);

export function isSessionArtifactCategory(value: string): value is SessionArtifactCategory {
  return CATEGORY_SET.has(value);
}

export function isSessionArtifactUri(value: string): boolean {
  return value.startsWith(SESSION_ARTIFACT_SCHEME);
}

export function formatSessionArtifactUri(category: SessionArtifactCategory, relativePath: string): string {
  return `${SESSION_ARTIFACT_SCHEME}${category}/${relativePath.replace(/\\/g, '/')}`;
}

export function shortArtifactHash(hash: string): string {
  const normalized = hash.trim().toLowerCase();
  return normalized.length <= 8 ? normalized : normalized.slice(0, 8);
}

/**
 * 解析 `session://<category>/<relative-path>`。
 * 拒绝对路径、`..`、空段、反斜杠逃逸与未知 category。
 */
export function parseSessionArtifactUri(uri: string): ParsedSessionArtifactUri {
  if (typeof uri !== 'string' || uri.trim().length === 0) {
    throw new SessionArtifactError('ARTIFACT_URI_INVALID', 'URI is empty.');
  }
  const trimmed = uri.trim();
  if (!trimmed.startsWith(SESSION_ARTIFACT_SCHEME)) {
    throw new SessionArtifactError('ARTIFACT_URI_INVALID', `expected ${SESSION_ARTIFACT_SCHEME}<category>/<path>`);
  }
  const remainder = trimmed.slice(SESSION_ARTIFACT_SCHEME.length);
  if (!remainder || remainder.includes('\\') || remainder.includes('\0')) {
    throw new SessionArtifactError('ARTIFACT_URI_INVALID', 'backslash, NUL, or empty path is not allowed.');
  }
  const slash = remainder.indexOf('/');
  if (slash <= 0 || slash === remainder.length - 1) {
    throw new SessionArtifactError('ARTIFACT_URI_INVALID', 'category and relative path are required.');
  }
  const category = remainder.slice(0, slash);
  if (!isSessionArtifactCategory(category)) {
    throw new SessionArtifactError('ARTIFACT_CATEGORY_UNKNOWN', category);
  }
  const rawRelative = remainder.slice(slash + 1);
  if (/^[a-zA-Z]:/.test(rawRelative) || rawRelative.startsWith('/') || rawRelative.startsWith('\\')) {
    throw new SessionArtifactError('ARTIFACT_PATH_ESCAPE', 'absolute paths are not allowed.');
  }
  const segments = rawRelative.split('/');
  if (segments.length === 0 || segments.some((segment) => segment.length === 0)) {
    throw new SessionArtifactError('ARTIFACT_URI_INVALID', 'relative path is empty.');
  }
  for (const segment of segments) {
    if (segment === '.' || segment === '..' || segment === '%2e' || segment === '%2E' || segment === '%2e%2e') {
      throw new SessionArtifactError('ARTIFACT_PATH_ESCAPE', 'path traversal is not allowed.');
    }
    let decoded = segment;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      throw new SessionArtifactError('ARTIFACT_URI_INVALID', 'malformed percent-encoding.');
    }
    if (decoded === '.' || decoded === '..' || decoded.includes('\\') || decoded.includes('\0') || decoded.includes('/')
      || /^[a-zA-Z]:/.test(decoded)) {
      throw new SessionArtifactError('ARTIFACT_PATH_ESCAPE', 'path traversal is not allowed.');
    }
  }
  return { category, relativePath: segments.join('/') };
}

export function extractSessionArtifactUris(value: string): string[] {
  const matches = value.match(/session:\/\/[a-z0-9-]+\/[^\s"'<>]+/gi) ?? [];
  const uris: string[] = [];
  for (const match of matches) {
    try {
      parseSessionArtifactUri(match.replace(/[.,;:]+$/, ''));
      uris.push(match.replace(/[.,;:]+$/, ''));
    } catch {
      // ignore non-canonical matches
    }
  }
  return uris;
}
