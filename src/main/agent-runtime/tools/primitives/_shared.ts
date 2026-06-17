/**
 * Primitive 工具共享工具函数。
 *
 * - workspace 根目录解析：优先使用工具执行上下文中的 project root，
 *   其次 `RDC_WORKSPACE_ROOT` 环境变量，最后回退到 `process.cwd()`。
 * - safeResolvePath：解析路径并确保位于 workspace 内。
 */

import * as os from 'os';
import * as path from 'path';
import type { ToolExecutionContext } from '../../agent/AgentTool';

let temporaryAllowedPathRoots: string[] = [];

export async function withTemporaryPathAccess<T>(
  roots: string[],
  run: () => Promise<T>,
): Promise<T> {
  const previous = temporaryAllowedPathRoots;
  temporaryAllowedPathRoots = [
    ...previous,
    ...roots.map((root) => normalizeInputPath(root)),
  ];
  try {
    return await run();
  } finally {
    temporaryAllowedPathRoots = previous;
  }
}

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

function isWithinRoot(target: string, root: string): boolean {
  if (root === '*') return true;
  const resolvedRoot = path.resolve(root);
  const rel = path.relative(resolvedRoot, target);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * 解析输入路径并确保结果位于 workspace 内。
 * 越界时抛出 Error，由调用方转为工具错误结果。
 */
export function safeResolvePath(input: string, root?: string, context?: ToolExecutionContext): string {
  if (typeof input !== 'string' || input.length === 0) {
    throw new Error('路径不能为空');
  }
  const workspaceRoot = root ?? getWorkspaceRoot(context);
  const expandedInput = normalizeInputPath(input);
  const target = path.isAbsolute(expandedInput)
    ? path.resolve(expandedInput)
    : path.resolve(workspaceRoot, expandedInput);
  const rel = path.relative(workspaceRoot, target);
  if ((rel.startsWith('..') || path.isAbsolute(rel)) && !temporaryAllowedPathRoots.some((root) => isWithinRoot(target, root))) {
    throw new Error(`路径 "${input}" 超出 workspace (${workspaceRoot})`);
  }
  return target;
}

/** 把 AbortSignal 转为 Promise（在 abort 时 reject）。 */
export function abortPromise(signal?: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    if (!signal) return;
    if (signal.aborted) {
      reject(new Error('Aborted'));
      return;
    }
    const onAbort = (): void => {
      signal.removeEventListener('abort', onAbort);
      reject(new Error('Aborted'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/** 截断超长输出，保留前后部分并标注被截断的字节数。 */
export function truncateOutput(text: string, maxBytes = 50 * 1024): string {
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) {
    return text;
  }
  // 简化处理：按字符截断，保留前 70%、后 20%。
  const head = Math.floor(maxBytes * 0.7);
  const tail = Math.floor(maxBytes * 0.2);
  const omitted =
    Buffer.byteLength(text, 'utf8') - head - tail;
  return (
    text.slice(0, head) +
    `\n... [truncated ${omitted} bytes] ...\n` +
    text.slice(text.length - tail)
  );
}
