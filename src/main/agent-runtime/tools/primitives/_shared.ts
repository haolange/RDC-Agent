/**
 * Primitive 工具共享工具函数。
 *
 * - workspace 根目录解析：优先使用工具执行上下文中的 project root，
 *   其次 `RDC_WORKSPACE_ROOT` 环境变量，最后回退到 `process.cwd()`。
 * - safeResolvePath：词法解析 + realpath，确保最终目标位于 workspace 内。
 * - truncateOutput：按 UTF-8 字节硬截断。
 * - assertTextReadable / assertFileSizeCap：文本工具二进制与体积门禁。
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { ToolExecutionContext } from '../../agent/AgentTool';
import { BINARY_SAMPLE_BYTES, TEXT_FILE_MAX_BYTES } from './toolLimits';

/**
 * 获取 workspace 根目录（绝对路径）。
 * 优先使用执行上下文中的 project root，使工具相对当前激活项目解析路径。
 */
export function getWorkspaceRoot(context?: ToolExecutionContext): string {
  if (context?.projectRootPath) {
    return path.resolve(context.projectRootPath);
  }
  const fromEnv = process.env.RDC_WORKSPACE_ROOT?.trim();
  if (fromEnv && fromEnv.length > 0) {
    return path.resolve(fromEnv);
  }
  return path.resolve(process.cwd());
}

function normalizeInputPath(input: string): string {
  const trimmed = input.trim();
  if (trimmed === '~') return os.homedir();
  if (trimmed.startsWith('~/') || trimmed.startsWith('~\\')) {
    return path.resolve(os.homedir(), trimmed.slice(2));
  }
  return trimmed.replace(/^%USERPROFILE%/i, os.homedir());
}

export function isWithinRoot(target: string, root: string): boolean {
  if (root === '*') return true;
  const resolvedRoot = path.resolve(root);
  const rel = path.relative(resolvedRoot, target);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function assertInsideAllowedRoots(
  target: string,
  workspaceRoot: string,
  input: string,
  context?: ToolExecutionContext,
): void {
  const rel = path.relative(workspaceRoot, target);
  const insideWorkspace = rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
  if (insideWorkspace) return;
  const temporaryRoots = context?.temporaryAllowedPathRoots ?? [];
  if (temporaryRoots.some((root) => isWithinRoot(target, root))) return;
  throw new Error(`路径 "${input}" 超出 workspace (${workspaceRoot})`);
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
  let resolved = fs.existsSync(current) ? fs.realpathSync(current) : current;
  for (const part of missing) {
    resolved = path.join(resolved, part);
  }
  return path.resolve(resolved);
}

/**
 * 解析输入路径并确保最终（realpath）目标位于 workspace 内。
 * 越界时抛出 Error，由调用方转为工具错误结果。
 */
export function safeResolvePath(input: string, root?: string, context?: ToolExecutionContext): string {
  if (typeof input !== 'string' || input.length === 0) {
    throw new Error('路径不能为空');
  }
  const workspaceRoot = root ?? getWorkspaceRoot(context);
  const expandedInput = normalizeInputPath(input);
  const lexical = path.isAbsolute(expandedInput)
    ? path.resolve(expandedInput)
    : path.resolve(workspaceRoot, expandedInput);

  assertInsideAllowedRoots(lexical, workspaceRoot, input, context);

  const resolved = realpathExistingAncestor(lexical);
  assertInsideAllowedRoots(resolved, workspaceRoot, input, context);
  return resolved;
}

/** AbortSignal → Promise，返回可 dispose 的句柄以防 listener 泄漏。 */
export function abortPromise(signal?: AbortSignal): {
  promise: Promise<never>;
  dispose: () => void;
} {
  let onAbort: (() => void) | null = null;
  const dispose = (): void => {
    if (signal && onAbort) {
      signal.removeEventListener('abort', onAbort);
      onAbort = null;
    }
  };
  const promise = new Promise<never>((_, reject) => {
    if (!signal) return;
    if (signal.aborted) {
      reject(new Error('Aborted'));
      return;
    }
    onAbort = (): void => {
      dispose();
      reject(new Error('Aborted'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
  return { promise, dispose };
}

/** Slice a UTF-8 string so the result is at most `maxBytes` bytes (O(N) via Buffer). */
export function sliceUtf8Bytes(text: string, maxBytes: number): string {
  if (maxBytes <= 0) return '';
  const buf = Buffer.from(text, 'utf8');
  if (buf.byteLength <= maxBytes) return text;
  let end = maxBytes;
  // Walk back to a codepoint boundary (not a continuation byte 10xxxxxx).
  while (end > 0 && (buf[end] & 0xc0) === 0x80) {
    end -= 1;
  }
  return buf.subarray(0, end).toString('utf8');
}

/** 截断超长输出，保留前后部分并标注被截断的字节数（UTF-8 字节硬顶）。 */
export function truncateOutput(text: string, maxBytes = 50 * 1024): string {
  const total = Buffer.byteLength(text, 'utf8');
  if (total <= maxBytes) {
    return text;
  }
  const markerBase = '\n... [truncated 0 bytes] ...\n';
  const markerReserve = Buffer.byteLength(markerBase, 'utf8') + 24;
  const available = Math.max(16, maxBytes - markerReserve);
  const headBudget = Math.floor(available * 0.7);
  const tailBudget = available - headBudget;

  const head = sliceUtf8Bytes(text, headBudget);
  // Build tail from the end by binary-searching a start index.
  let start = text.length;
  let low = 0;
  let high = text.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    const candidate = text.slice(mid);
    if (Buffer.byteLength(candidate, 'utf8') > tailBudget) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  start = low;
  const tail = text.slice(start);
  const omitted = Math.max(0, total - Buffer.byteLength(head, 'utf8') - Buffer.byteLength(tail, 'utf8'));
  const marker = `\n... [truncated ${omitted} bytes] ...\n`;
  const result = head + marker + tail;
  if (Buffer.byteLength(result, 'utf8') <= maxBytes) {
    return result;
  }
  return sliceUtf8Bytes(result, maxBytes);
}

export function formatBinaryRejectMessage(absolutePath: string, reason: string): string {
  const ext = path.extname(absolutePath).toLowerCase();
  if (ext === '.rdc') {
    return (
      `Cannot read binary RenderDoc capture as text: ${absolutePath}. `
      + 'Open the .rdc via the session Capture panel / RDX runtime instead of read_file.'
    );
  }
  return `Cannot read binary file as text: ${absolutePath} (${reason}). Use an appropriate binary or domain tool.`;
}

export function assertFileSizeCap(absolutePath: string, maxBytes: number, label = 'File'): void {
  const stat = fs.statSync(absolutePath);
  if (!stat.isFile()) {
    throw new Error(`${label} is not a regular file: ${absolutePath}`);
  }
  if (stat.size > maxBytes) {
    throw new Error(
      `${label} exceeds size limit (${stat.size} bytes > ${maxBytes} bytes): ${absolutePath}`,
    );
  }
}

function sampleLooksBinary(sample: Buffer): string | null {
  if (sample.includes(0)) {
    return 'NUL byte in file head';
  }
  if (sample.length >= 4) {
    // RenderDoc capture magic "RDOC"
    if (
      sample[0] === 0x52
      && sample[1] === 0x44
      && sample[2] === 0x4f
      && sample[3] === 0x43
    ) {
      return 'RenderDoc RDOC magic';
    }
  }
  let suspicious = 0;
  const take = Math.min(sample.length, BINARY_SAMPLE_BYTES);
  for (let i = 0; i < take; i += 1) {
    const b = sample[i];
    if (b === 9 || b === 10 || b === 13) continue;
    if (b < 32 || b === 127) suspicious += 1;
  }
  if (take > 0 && suspicious / take > 0.3) {
    return 'high control-byte ratio';
  }
  return null;
}

/**
 * Fail-closed gate for text-oriented tools.
 * Rejects .rdc, RenderDoc magic, NUL samples, and oversized files (default 8MB).
 */
export function assertTextReadable(
  absolutePath: string,
  options?: { maxBytes?: number },
): void {
  const ext = path.extname(absolutePath).toLowerCase();
  if (ext === '.rdc') {
    throw new Error(formatBinaryRejectMessage(absolutePath, 'RenderDoc capture extension'));
  }
  const maxBytes = options?.maxBytes ?? TEXT_FILE_MAX_BYTES;
  assertFileSizeCap(absolutePath, maxBytes, 'Text file');

  const fd = fs.openSync(absolutePath, 'r');
  try {
    const sample = Buffer.alloc(BINARY_SAMPLE_BYTES);
    const bytesRead = fs.readSync(fd, sample, 0, BINARY_SAMPLE_BYTES, 0);
    const reason = sampleLooksBinary(sample.subarray(0, bytesRead));
    if (reason) {
      throw new Error(formatBinaryRejectMessage(absolutePath, reason));
    }
  } finally {
    fs.closeSync(fd);
  }
}

/** Reject deletes under reserved relative segments such as `.git`. */
export function assertNotSensitiveDeletePath(absolutePath: string, workspaceRoot: string): void {
  const rel = path.relative(workspaceRoot, absolutePath).split(path.sep).join('/');
  const parts = rel.split('/').filter(Boolean);
  if (parts[0] === '.git' || parts.includes('.git')) {
    throw new Error(`Refusing to delete path under .git: ${absolutePath}`);
  }
}

export function isPathExisting(absolutePath: string): boolean {
  try {
    fs.accessSync(absolutePath);
    return true;
  } catch {
    return false;
  }
}
