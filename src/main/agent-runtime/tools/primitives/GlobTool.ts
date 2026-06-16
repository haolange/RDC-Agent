/**
 * GlobTool — 在 workspace 内进行 glob 匹配。
 *
 * - 实现一个轻量的 glob → 正则编译器，支持：
 *     `*`        匹配同层任意字符（不含 `/`）
 *     `**`       匹配任意层级目录
 *     `?`        匹配单个字符（不含 `/`）
 *     `{a,b,c}`  分组匹配
 *     `[abc]`    字符集合
 * - 不引入第三方依赖，递归遍历 workspace（默认忽略 node_modules / .git / out /
 *   release / dist / .qoder / .tmp / test-results / .codex 等噪声目录）。
 * - 单次最多返回 1000 个结果，超过后截断并标注。
 */

import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import type { AgentTool } from '../../agent/AgentTool';
import { getWorkspaceRoot, safeResolvePath } from './_shared';

interface GlobParams {
  pattern: string;
  cwd?: string;
}

interface GlobDetails {
  pattern: string;
  cwd: string;
  matched: number;
  truncated: boolean;
}

const MAX_RESULTS = 1000;

const DEFAULT_IGNORED_DIRS = new Set<string>([
  'node_modules',
  '.git',
  'out',
  'release',
  'dist',
  '.qoder',
  '.tmp',
  'test-results',
  '.codex',
]);

export const globTool: AgentTool<GlobParams, GlobDetails> = {
  name: 'glob',
  label: '文件搜索',
  description:
    'Search for files matching a glob pattern in the workspace. Supports *, **, ?, {a,b}, and [abc].',
  parameters: {
    type: 'object',
    properties: {
      pattern: {
        type: 'string',
        description:
          'Glob pattern, e.g. "src/**/*.ts" or "**/*.{json,md}".',
      },
      cwd: {
        type: 'string',
        description:
          'Optional sub-directory inside the workspace to search from (default: workspace root).',
      },
    },
    required: ['pattern'],
  },
  spec: { isReadOnly: true, isConcurrencySafe: true, isDestructive: false, sideEffect: 'none', category: 'search', requiresApproval: false },
  permissionHint: 'readonly',

  async execute(_toolCallId, params, signal) {
    if (signal?.aborted) {
      throw new Error('Aborted');
    }

    const workspaceRoot = getWorkspaceRoot();
    const externalPattern = params.cwd ? null : splitExternalPattern(params.pattern);
    const baseDir = params.cwd
      ? safeResolvePath(params.cwd, workspaceRoot)
      : externalPattern
        ? safeResolvePath(externalPattern.baseDir, workspaceRoot)
        : workspaceRoot;
    const pattern = externalPattern?.pattern ?? params.pattern;

    const regex = compileGlob(pattern);
    const matches: string[] = [];
    let truncated = false;

    await walk(baseDir, baseDir, async (relPath) => {
      if (signal?.aborted) {
        throw new Error('Aborted');
      }
      const normalized = relPath.split(path.sep).join('/');
      if (regex.test(normalized)) {
        if (matches.length >= MAX_RESULTS) {
          truncated = true;
          return false;
        }
        matches.push(normalized);
      }
      return true;
    });

    matches.sort();

    const text =
      matches.length === 0
        ? `(no matches for pattern "${pattern}")`
        : matches.join('\n') + (truncated ? `\n... [truncated at ${MAX_RESULTS}]` : '');

    return {
      content: [{ type: 'text', text }],
      details: {
        pattern,
        cwd: baseDir,
        matched: matches.length,
        truncated,
      },
    };
  },
};

function expandUserPath(value: string): string {
  const trimmed = value.trim();
  if (trimmed === '~') return os.homedir();
  if (trimmed.startsWith('~/') || trimmed.startsWith('~\\')) {
    return path.resolve(os.homedir(), trimmed.slice(2));
  }
  return trimmed.replace(/^%USERPROFILE%/i, os.homedir());
}

function splitExternalPattern(pattern: string): { baseDir: string; pattern: string } | null {
  const expanded = expandUserPath(pattern);
  if (!path.isAbsolute(expanded)) return null;

  const wildcardIndex = expanded.search(/[*?{[]/);
  if (wildcardIndex < 0) {
    return {
      baseDir: path.dirname(expanded),
      pattern: path.basename(expanded),
    };
  }

  const sepIndex = Math.max(expanded.lastIndexOf('/', wildcardIndex), expanded.lastIndexOf('\\', wildcardIndex));
  const baseDir = sepIndex > 0 ? expanded.slice(0, sepIndex) : path.parse(expanded).root;
  const normalizedPattern = expanded.slice(sepIndex + 1).replace(/\\/g, '/');
  return {
    baseDir,
    pattern: normalizedPattern || '*',
  };
}

// =====================================================================
// 内部：轻量 glob → RegExp 编译器
// =====================================================================

function compileGlob(pattern: string): RegExp {
  let i = 0;
  let out = '^';

  while (i < pattern.length) {
    const ch = pattern[i];

    if (ch === '*') {
      if (pattern[i + 1] === '*') {
        // **：跨目录匹配。'**/' 视为 0..N 段；末尾 '**' 视为任意。
        if (pattern[i + 2] === '/') {
          out += '(?:.*/)?';
          i += 3;
          continue;
        }
        out += '.*';
        i += 2;
        continue;
      }
      // 单 *：同层（不跨 /）。
      out += '[^/]*';
      i++;
      continue;
    }

    if (ch === '?') {
      out += '[^/]';
      i++;
      continue;
    }

    if (ch === '{') {
      const end = pattern.indexOf('}', i);
      if (end < 0) {
        out += escapeReg(ch);
        i++;
        continue;
      }
      const parts = pattern
        .slice(i + 1, end)
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean);
      if (parts.length === 0) {
        out += escapeReg(ch);
        i++;
        continue;
      }
      out += '(?:' + parts.map((p) => compileGlob(p).source.replace(/^\^|\$$/g, '')).join('|') + ')';
      i = end + 1;
      continue;
    }

    if (ch === '[') {
      const end = pattern.indexOf(']', i);
      if (end < 0) {
        out += escapeReg(ch);
        i++;
        continue;
      }
      out += pattern.slice(i, end + 1);
      i = end + 1;
      continue;
    }

    out += escapeReg(ch);
    i++;
  }

  out += '$';
  return new RegExp(out);
}

function escapeReg(ch: string): string {
  if (/[.+^$()|\\]/.test(ch)) return '\\' + ch;
  return ch;
}

// =====================================================================
// 内部：递归遍历
// =====================================================================

async function walk(
  root: string,
  current: string,
  visit: (relativePath: string) => Promise<boolean>,
): Promise<boolean> {
  let entries: import('fs').Dirent[];
  try {
    entries = await fs.readdir(current, { withFileTypes: true });
  } catch {
    return true;
  }

  for (const entry of entries) {
    const abs = path.join(current, entry.name);
    if (entry.isDirectory()) {
      if (DEFAULT_IGNORED_DIRS.has(entry.name)) {
        continue;
      }
      const cont = await walk(root, abs, visit);
      if (!cont) return false;
    } else if (entry.isFile()) {
      const rel = path.relative(root, abs);
      const cont = await visit(rel);
      if (!cont) return false;
    }
  }
  return true;
}
