/**
 * Primitive 工具共享工具函数。
 *
 * - workspace 根目录解析：优先使用 `RDC_WORKSPACE_ROOT` 环境变量，
 *   否则回退到 `process.cwd()`。
 * - safeResolvePath：解析路径并确保位于 workspace 内。
 */

import * as path from 'path';

/** 获取 workspace 根目录（绝对路径）。 */
export function getWorkspaceRoot(): string {
  const fromEnv = process.env.RDC_WORKSPACE_ROOT?.trim();
  if (fromEnv && fromEnv.length > 0) {
    return path.resolve(fromEnv);
  }
  return path.resolve(process.cwd());
}

/**
 * 解析输入路径并确保结果位于 workspace 内。
 * 越界时抛出 Error，由调用方转为工具错误结果。
 */
export function safeResolvePath(input: string, root?: string): string {
  if (typeof input !== 'string' || input.length === 0) {
    throw new Error('路径不能为空');
  }
  const workspaceRoot = root ?? getWorkspaceRoot();
  const target = path.isAbsolute(input)
    ? path.resolve(input)
    : path.resolve(workspaceRoot, input);
  const rel = path.relative(workspaceRoot, target);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
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
