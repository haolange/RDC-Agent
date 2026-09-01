/**
 * SessionArtifactResolver — session:// 所有权 / realpath / 配额 / MIME / hash / 原子写。
 * 不走 workspace safeResolvePath，也不进入 attachments 自动授权。
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import {
  ARTIFACT_READ_MAX_OUTPUT_BYTES,
  ARTIFACT_READ_MAX_OUTPUT_LINES,
  formatSessionArtifactUri,
  parseSessionArtifactUri,
  SESSION_ARTIFACT_ALLOWED_MIME_SET,
  SESSION_ARTIFACT_MAX_FILE_BYTES,
  SESSION_ARTIFACT_MAX_SESSION_BYTES,
  SESSION_ARTIFACT_MAX_TOOL_OUTPUT_FILES,
  SESSION_ARTIFACT_ROOT_DIR,
  SessionArtifactError,
  type ParsedSessionArtifactUri,
  type SessionArtifactCategory,
} from '@shared/types/sessionArtifact';
import { StorageIo } from './StorageIo';
import { storageAdapter } from './StorageAdapter';

const EXECUTABLE_EXTENSIONS = new Set([
  '.exe', '.dll', '.so', '.dylib', '.bin', '.com', '.msi', '.bat', '.cmd',
  '.ps1', '.sh', '.bash', '.zsh', '.fish', '.app', '.scr', '.pif', '.cpl',
]);

const MIME_BY_EXTENSION: Record<string, string> = {
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.markdown': 'text/markdown',
  '.json': 'application/json',
  '.csv': 'text/csv',
  '.yml': 'text/yaml',
  '.yaml': 'text/yaml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

export interface SessionArtifactResolverDeps {
  resolveSessionPath?: (sessionId: string) => string | null;
  io?: StorageIo;
  maxFileBytes?: number;
  maxSessionBytes?: number;
  maxToolOutputFiles?: number;
}

export interface SessionArtifactResolved {
  sessionId: string;
  sessionPath: string;
  category: SessionArtifactCategory;
  relativePath: string;
  uri: string;
  absolutePath: string;
  categoryRoot: string;
  artifactsRoot: string;
}

export interface SessionArtifactReadResult {
  uri: string;
  category: SessionArtifactCategory;
  relativePath: string;
  mimeType: string;
  hash: string;
  bytes: number;
  text?: string;
  truncated: boolean;
  offset: number;
  limit: number;
  totalLines?: number;
}

export interface SessionArtifactWriteResult {
  uri: string;
  category: SessionArtifactCategory;
  relativePath: string;
  mimeType: string;
  hash: string;
  bytes: number;
}

function defaultResolveSessionPath(sessionId: string): string | null {
  try {
    const session = storageAdapter.readSession(sessionId);
    const sessionPath = session?.sessionPath?.trim();
    return sessionPath || null;
  } catch {
    return null;
  }
}

function isWithinRoot(target: string, root: string): boolean {
  const resolvedRoot = path.resolve(root);
  const rel = path.relative(resolvedRoot, target);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function assertNoSymlinkPath(target: string): void {
  let current = path.resolve(target);
  while (fs.existsSync(current)) {
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) {
      throw new SessionArtifactError(
        'ARTIFACT_SYMLINK_REJECTED',
        `refusing to follow symlink/reparse path ${current}.`,
      );
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
}

function assertNoHardlinkFile(target: string, stat?: fs.Stats): void {
  const fileStat = stat ?? fs.lstatSync(target);
  if (fileStat.isSymbolicLink()) {
    throw new SessionArtifactError(
      'ARTIFACT_SYMLINK_REJECTED',
      `refusing to follow symlink/reparse path ${target}.`,
    );
  }
  if (fileStat.isFile() && fileStat.nlink > 1) {
    throw new SessionArtifactError(
      'ARTIFACT_HARDLINK_REJECTED',
      `refusing hardlinked file ${target} (nlink=${fileStat.nlink}).`,
    );
  }
}

function realpathExistingAncestor(target: string): string {
  let current = path.resolve(target);
  const missing: string[] = [];
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) break;
    missing.unshift(path.basename(current));
    current = parent;
  }
  if (fs.existsSync(current)) {
    assertNoSymlinkPath(current);
    current = fs.realpathSync.native ? fs.realpathSync.native(current) : fs.realpathSync(current);
  }
  for (const part of missing) {
    current = path.join(current, part);
  }
  return path.resolve(current);
}

function isPng(bytes: Buffer): boolean {
  return bytes.length >= 8
    && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
}

function isJpeg(bytes: Buffer): boolean {
  return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

function isGif(bytes: Buffer): boolean {
  return bytes.length >= 6
    && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38
    && (bytes[4] === 0x37 || bytes[4] === 0x39) && bytes[5] === 0x61;
}

function isWebp(bytes: Buffer): boolean {
  return bytes.length >= 12
    && bytes.toString('ascii', 0, 4) === 'RIFF'
    && bytes.toString('ascii', 8, 12) === 'WEBP';
}

function isSvg(bytes: Buffer): boolean {
  const head = bytes.subarray(0, Math.min(bytes.length, 512)).toString('utf8').trimStart().toLowerCase();
  return head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg'));
}

function isPe(bytes: Buffer): boolean {
  return bytes.length >= 2 && bytes[0] === 0x4d && bytes[1] === 0x5a;
}

function isElf(bytes: Buffer): boolean {
  return bytes.length >= 4
    && bytes[0] === 0x7f && bytes[1] === 0x45 && bytes[2] === 0x4c && bytes[3] === 0x46;
}

function isRdoc(bytes: Buffer): boolean {
  return bytes.length >= 4
    && bytes[0] === 0x52 && bytes[1] === 0x44 && bytes[2] === 0x4f && bytes[3] === 0x43;
}

function detectImageMagicMime(bytes: Buffer): string | null {
  if (isPng(bytes)) return 'image/png';
  if (isJpeg(bytes)) return 'image/jpeg';
  if (isGif(bytes)) return 'image/gif';
  if (isWebp(bytes)) return 'image/webp';
  return null;
}

function looksLikeUtf8Text(bytes: Buffer): boolean {
  if (bytes.includes(0)) return false;
  try {
    return Buffer.from(bytes.toString('utf8'), 'utf8').equals(bytes);
  } catch {
    return false;
  }
}

function sha256Hex(bytes: Buffer): string {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function walkFiles(root: string, visitor: (filePath: string, stat: fs.Stats) => void): void {
  if (!fs.existsSync(root)) return;
  assertNoSymlinkPath(root);
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop()!;
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) {
      throw new SessionArtifactError('ARTIFACT_SYMLINK_REJECTED', current);
    }
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(current)) {
        stack.push(path.join(current, entry));
      }
      continue;
    }
    if (stat.isFile()) visitor(current, stat);
  }
}

export class SessionArtifactResolver {
  private readonly resolveSessionPath: (sessionId: string) => string | null;
  private readonly io: StorageIo;
  private readonly maxFileBytes: number;
  private readonly maxSessionBytes: number;
  private readonly maxToolOutputFiles: number;

  constructor(deps: SessionArtifactResolverDeps = {}) {
    this.resolveSessionPath = deps.resolveSessionPath ?? defaultResolveSessionPath;
    this.io = deps.io ?? new StorageIo();
    this.maxFileBytes = deps.maxFileBytes ?? SESSION_ARTIFACT_MAX_FILE_BYTES;
    this.maxSessionBytes = deps.maxSessionBytes ?? SESSION_ARTIFACT_MAX_SESSION_BYTES;
    this.maxToolOutputFiles = deps.maxToolOutputFiles ?? SESSION_ARTIFACT_MAX_TOOL_OUTPUT_FILES;
  }

  parse(uri: string): ParsedSessionArtifactUri {
    return parseSessionArtifactUri(uri);
  }

  resolve(sessionId: string | null | undefined, uri: string): SessionArtifactResolved {
    if (!sessionId?.trim()) {
      throw new SessionArtifactError('ARTIFACT_SESSION_DENIED', 'an owning session is required.');
    }
    const owningSessionId = sessionId.trim();
    const sessionPath = this.resolveSessionPath(owningSessionId);
    if (!sessionPath) {
      throw new SessionArtifactError('ARTIFACT_SESSION_DENIED', `session not found: ${owningSessionId}`);
    }
    const parsed = parseSessionArtifactUri(uri);
    const resolvedSession = path.resolve(sessionPath);
    if (!fs.existsSync(resolvedSession)) {
      throw new SessionArtifactError('ARTIFACT_SESSION_DENIED', `session path missing: ${owningSessionId}`);
    }
    assertNoSymlinkPath(resolvedSession);
    const realSession = fs.realpathSync.native
      ? fs.realpathSync.native(resolvedSession)
      : fs.realpathSync(resolvedSession);
    const artifactsRoot = path.join(realSession, SESSION_ARTIFACT_ROOT_DIR);
    const categoryRoot = path.join(artifactsRoot, parsed.category);
    const lexical = path.resolve(categoryRoot, parsed.relativePath);
    if (!isWithinRoot(lexical, categoryRoot) || !isWithinRoot(lexical, realSession)) {
      throw new SessionArtifactError('ARTIFACT_PATH_ESCAPE', 'lexical path escaped the owning session.');
    }
    const resolved = realpathExistingAncestor(lexical);
    if (!isWithinRoot(resolved, categoryRoot) || !isWithinRoot(resolved, realSession)) {
      throw new SessionArtifactError('ARTIFACT_PATH_ESCAPE', 'resolved path escaped the owning session.');
    }
    assertNoSymlinkPath(resolved);
    return {
      sessionId: owningSessionId,
      sessionPath: realSession,
      category: parsed.category,
      relativePath: parsed.relativePath,
      uri: formatSessionArtifactUri(parsed.category, parsed.relativePath),
      absolutePath: resolved,
      categoryRoot,
      artifactsRoot,
    };
  }

  read(
    sessionId: string | null | undefined,
    uri: string,
    options?: { offset?: number; limit?: number; expectedHash?: string },
  ): SessionArtifactReadResult {
    const resolved = this.resolve(sessionId, uri);
    if (!fs.existsSync(resolved.absolutePath)) {
      throw new SessionArtifactError('ARTIFACT_NOT_FOUND', resolved.uri);
    }
    const stat = fs.lstatSync(resolved.absolutePath);
    if (stat.isSymbolicLink()) {
      throw new SessionArtifactError('ARTIFACT_SYMLINK_REJECTED', resolved.absolutePath);
    }
    if (!stat.isFile()) {
      throw new SessionArtifactError('ARTIFACT_NOT_FOUND', 'target is not a regular file.');
    }
    assertNoHardlinkFile(resolved.absolutePath, stat);
    if (stat.size > this.maxFileBytes) {
      throw new SessionArtifactError(
        'ARTIFACT_TOO_LARGE',
        `${stat.size} bytes exceeds ${this.maxFileBytes} bytes.`,
      );
    }
    const bytes = fs.readFileSync(resolved.absolutePath);
    const mimeType = this.assertAllowedBytes(resolved.relativePath, bytes);
    const hash = sha256Hex(bytes);
    if (options?.expectedHash && options.expectedHash.toLowerCase() !== hash) {
      throw new SessionArtifactError('ARTIFACT_HASH_MISMATCH', 'sha256 does not match expectedHash.');
    }
    const offset = Math.max(1, Math.floor(options?.offset ?? 1));
    const limit = Math.max(
      1,
      Math.min(ARTIFACT_READ_MAX_OUTPUT_LINES, Math.floor(options?.limit ?? ARTIFACT_READ_MAX_OUTPUT_LINES)),
    );
    if (mimeType.startsWith('image/')) {
      return {
        uri: resolved.uri,
        category: resolved.category,
        relativePath: resolved.relativePath,
        mimeType,
        hash,
        bytes: bytes.length,
        truncated: false,
        offset: 1,
        limit,
      };
    }
    const text = bytes.toString('utf8');
    const lines = text.replace(/\r\n/g, '\n').split('\n');
    const window = lines.slice(offset - 1, offset - 1 + limit);
    let rendered = window.join('\n');
    let truncated = offset - 1 + window.length < lines.length;
    if (Buffer.byteLength(rendered, 'utf8') > ARTIFACT_READ_MAX_OUTPUT_BYTES) {
      rendered = this.sliceUtf8(rendered, ARTIFACT_READ_MAX_OUTPUT_BYTES);
      truncated = true;
    }
    return {
      uri: resolved.uri,
      category: resolved.category,
      relativePath: resolved.relativePath,
      mimeType,
      hash,
      bytes: bytes.length,
      text: rendered,
      truncated,
      offset,
      limit,
      totalLines: lines.length,
    };
  }

  write(
    sessionId: string | null | undefined,
    uri: string,
    content: Buffer | string,
    options?: { mimeType?: string },
  ): SessionArtifactWriteResult {
    const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
    try {
      const resolved = this.resolve(sessionId, uri);
      if (bytes.length > this.maxFileBytes) {
        throw new SessionArtifactError(
          'ARTIFACT_TOO_LARGE',
          `${bytes.length} bytes exceeds ${this.maxFileBytes} bytes.`,
        );
      }
      const mimeType = this.assertAllowedBytes(resolved.relativePath, bytes, options?.mimeType);
      this.assertQuota(resolved, bytes.length);
      this.io.ensureDir(path.dirname(resolved.absolutePath));
      assertNoSymlinkPath(path.dirname(resolved.absolutePath));
      if (fs.existsSync(resolved.absolutePath)) {
        assertNoSymlinkPath(resolved.absolutePath);
        assertNoHardlinkFile(resolved.absolutePath);
      }
      this.io.writeBytesAtomic(resolved.absolutePath, bytes);
      assertNoSymlinkPath(resolved.absolutePath);
      assertNoHardlinkFile(resolved.absolutePath);
      const written = fs.readFileSync(resolved.absolutePath);
      return {
        uri: resolved.uri,
        category: resolved.category,
        relativePath: resolved.relativePath,
        mimeType,
        hash: sha256Hex(written),
        bytes: written.length,
      };
    } catch (error) {
      if (error instanceof SessionArtifactError) throw error;
      throw new SessionArtifactError(
        'ARTIFACT_WRITE_FAILED',
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  sweepToolOutputs(sessionId: string | null | undefined): void {
    if (!sessionId?.trim()) {
      throw new SessionArtifactError('ARTIFACT_SESSION_DENIED', 'an owning session is required.');
    }
    const sessionPath = this.resolveSessionPath(sessionId.trim());
    if (!sessionPath) {
      throw new SessionArtifactError('ARTIFACT_SESSION_DENIED', `session not found: ${sessionId}`);
    }
    const toolOutputsRoot = path.join(path.resolve(sessionPath), SESSION_ARTIFACT_ROOT_DIR, 'tool-outputs');
    if (!fs.existsSync(toolOutputsRoot)) return;
    assertNoSymlinkPath(toolOutputsRoot);
    if (!isWithinRoot(path.resolve(toolOutputsRoot), path.resolve(sessionPath))) {
      throw new SessionArtifactError('ARTIFACT_PATH_ESCAPE', 'sweep target escaped the owning session.');
    }
    fs.rmSync(toolOutputsRoot, { recursive: true, force: true });
  }

  private assertAllowedBytes(relativePath: string, bytes: Buffer, declaredMime?: string): string {
    const ext = path.extname(relativePath).toLowerCase();
    if (ext === '.rdc' || ext === '.svg' || ext === '.exe' || EXECUTABLE_EXTENSIONS.has(ext)) {
      throw new SessionArtifactError('ARTIFACT_MIME_DENIED', `extension ${ext || '(none)'} is not allowed.`);
    }
    if (isRdoc(bytes) || isSvg(bytes) || isPe(bytes) || isElf(bytes)) {
      throw new SessionArtifactError('ARTIFACT_MIME_DENIED', 'SVG, executable, or .rdc content is rejected.');
    }
    const magicMime = detectImageMagicMime(bytes);
    const extensionMime = MIME_BY_EXTENSION[ext];
    const declared = declaredMime?.trim().toLowerCase();
    if (declared && !SESSION_ARTIFACT_ALLOWED_MIME_SET.has(declared)) {
      throw new SessionArtifactError('ARTIFACT_MIME_DENIED', declared);
    }
    if (declared === 'image/svg+xml') {
      throw new SessionArtifactError('ARTIFACT_MIME_DENIED', declared);
    }
    let mime = declared ?? magicMime ?? extensionMime;
    if (!mime && looksLikeUtf8Text(bytes)) {
      mime = 'text/plain';
    }
    if (!mime || !SESSION_ARTIFACT_ALLOWED_MIME_SET.has(mime)) {
      throw new SessionArtifactError('ARTIFACT_MIME_DENIED', mime ?? 'unknown');
    }
    if (magicMime && mime.startsWith('image/') && magicMime !== mime) {
      throw new SessionArtifactError('ARTIFACT_MIME_DENIED', `magic ${magicMime} does not match ${mime}.`);
    }
    return mime;
  }

  private assertQuota(resolved: SessionArtifactResolved, incomingBytes: number): void {
    let totalBytes = 0;
    let toolOutputFiles = 0;
    let existingBytes = 0;
    walkFiles(resolved.artifactsRoot, (filePath, stat) => {
      totalBytes += stat.size;
      if (isWithinRoot(filePath, resolved.categoryRoot) && resolved.category === 'tool-outputs') {
        toolOutputFiles += 1;
      }
      if (path.resolve(filePath) === resolved.absolutePath) {
        existingBytes = stat.size;
      }
    });
    const nextTotal = totalBytes - existingBytes + incomingBytes;
    if (nextTotal > this.maxSessionBytes) {
      throw new SessionArtifactError(
        'ARTIFACT_QUOTA_EXCEEDED',
        `session artifacts would be ${nextTotal} bytes (cap ${this.maxSessionBytes}).`,
      );
    }
    if (resolved.category === 'tool-outputs') {
      const nextCount = toolOutputFiles + (existingBytes > 0 ? 0 : 1);
      if (nextCount > this.maxToolOutputFiles) {
        throw new SessionArtifactError(
          'ARTIFACT_QUOTA_EXCEEDED',
          `tool-outputs would have ${nextCount} files (cap ${this.maxToolOutputFiles}).`,
        );
      }
    }
  }

  private sliceUtf8(text: string, maxBytes: number): string {
    const buf = Buffer.from(text, 'utf8');
    if (buf.byteLength <= maxBytes) return text;
    let end = maxBytes;
    while (end > 0 && (buf[end] & 0xc0) === 0x80) end -= 1;
    return buf.subarray(0, end).toString('utf8');
  }
}

export const sessionArtifactResolver = new SessionArtifactResolver();
