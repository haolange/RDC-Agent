import * as fs from 'fs/promises';
import * as path from 'path';
import { getWorkspaceRoot, safeResolvePath, truncateOutput } from './_shared';
import { searchLongLines } from './GrepLongLineSearch';
import {
  GREP_MAX_FILE_BYTES,
  GREP_MAX_LINE_CHARS,
  GREP_MAX_OUTPUT_BYTES,
  GREP_REGEX_TIMEOUT_MS,
} from './toolLimits';
import type { AgentTool } from '../../agent/AgentTool';

interface GrepParams {
  pattern: string;
  path?: string;
  caseSensitive?: boolean;
  maxMatches?: number;
}

interface GrepDetails {
  pattern: string;
  root: string;
  matchedFiles: number;
  matchedLines: number;
  truncated: boolean;
}

const DEFAULT_MAX_MATCHES = 200;
const DEFAULT_IGNORED_DIRS = new Set([
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

export const grepTool: AgentTool<GrepParams, GrepDetails> = {
  name: 'grep',
  label: 'Search Text',
  description: 'Search text files in the workspace using a JavaScript regular expression or plain text pattern.',
  parameters: {
    type: 'object',
    properties: {
      pattern: {
        type: 'string',
        description: 'Text or JavaScript regular expression to search for.',
      },
      path: {
        type: 'string',
        description: 'Optional file or directory inside the workspace. Defaults to workspace root.',
      },
      caseSensitive: {
        type: 'boolean',
        description: 'Whether matching is case-sensitive. Defaults to false.',
      },
      maxMatches: {
        type: 'integer',
        description: 'Maximum matching lines to return. Defaults to 200.',
      },
    },
    required: ['pattern'],
  },
  spec: { isReadOnly: true, isConcurrencySafe: true, isDestructive: false, sideEffect: 'none', category: 'search', requiresApproval: false },
  permissionHint: 'readonly',

  async execute(_toolCallId, params, signal, _onUpdate, context) {
    throwIfAborted(signal);
    const workspaceRoot = getWorkspaceRoot(context);
    const root = params.path ? safeResolvePath(params.path, workspaceRoot, context) : workspaceRoot;
    const maxMatches = Math.max(1, Math.min(1000, Math.floor(params.maxMatches ?? DEFAULT_MAX_MATCHES)));
    const regex = compilePattern(params.pattern, params.caseSensitive === true);
    const matches: string[] = [];
    const matchedFiles = new Set<string>();
    const output = { clippedLine: false };

    const stat = await fs.stat(root);
    if (stat.isFile()) {
      await searchFile(root, workspaceRoot, regex, matches, matchedFiles, maxMatches, output, signal);
    } else if (stat.isDirectory()) {
      await walkAndSearch(root, workspaceRoot, regex, matches, matchedFiles, maxMatches, output, signal);
    } else {
      throw new Error(`Unsupported path type: ${root}`);
    }

    const rawText = matches.length > 0
      ? matches.join('\n')
      : `(no matches for pattern "${params.pattern}")`;
    const text = truncateOutput(rawText, GREP_MAX_OUTPUT_BYTES);
    const truncated = output.clippedLine || matches.length >= maxMatches
      || Buffer.byteLength(rawText, 'utf8') > GREP_MAX_OUTPUT_BYTES;

    return {
      content: [{ type: 'text', text }],
      details: {
        pattern: params.pattern,
        root,
        matchedFiles: matchedFiles.size,
        matchedLines: matches.length,
        truncated,
      },
    };
  },
};

function compilePattern(pattern: string, caseSensitive: boolean): RegExp {
  if (!pattern || !pattern.trim()) {
    throw new Error('pattern cannot be empty');
  }
  try {
    return new RegExp(pattern, caseSensitive ? 'g' : 'gi');
  } catch {
    return new RegExp(escapeRegExp(pattern), caseSensitive ? 'g' : 'gi');
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function walkAndSearch(
  current: string,
  workspaceRoot: string,
  regex: RegExp,
  matches: string[],
  matchedFiles: Set<string>,
  maxMatches: number,
  output: { clippedLine: boolean },
  signal?: AbortSignal,
): Promise<void> {
  throwIfAborted(signal);
  const entries = await fs.readdir(current, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (matches.length >= maxMatches) return;
    const absolute = path.join(current, entry.name);
    if (entry.isDirectory()) {
      if (!DEFAULT_IGNORED_DIRS.has(entry.name)) await walkAndSearch(absolute, workspaceRoot, regex, matches, matchedFiles, maxMatches, output, signal);
    } else if (entry.isFile()) {
      await searchFile(absolute, workspaceRoot, regex, matches, matchedFiles, maxMatches, output, signal);
    }
  }
}

async function searchFile(
  absolute: string,
  workspaceRoot: string,
  regex: RegExp,
  matches: string[],
  matchedFiles: Set<string>,
  maxMatches: number,
  output: { clippedLine: boolean },
  signal?: AbortSignal,
): Promise<void> {
  throwIfAborted(signal);
  if (matches.length >= maxMatches) return;
  const stat = await fs.stat(absolute).catch(() => null);
  if (!stat || !stat.isFile() || stat.size > GREP_MAX_FILE_BYTES) return;
  const buffer = await fs.readFile(absolute).catch(() => null);
  if (!buffer || buffer.includes(0)) return;
  const text = buffer.toString('utf8');
  const rel = path.relative(workspaceRoot, absolute).split(path.sep).join('/');
  const lines = text.split(/\r?\n/);
  if (lines.some((line) => line.length > GREP_MAX_LINE_CHARS)) {
    const found = await searchLongLines(lines, regex, maxMatches - matches.length, signal);
    throwIfAborted(signal);
    for (const hit of found) {
      const preview = clippedPreview(lines[hit.lineIndex], hit.matchIndex, hit.matchLength);
      output.clippedLine ||= preview.clipped;
      matchedFiles.add(rel);
      matches.push(`${rel}:${hit.lineIndex + 1}: ${preview.text}`);
    }
    return;
  }
  const deadline = Date.now() + GREP_REGEX_TIMEOUT_MS;
  for (let index = 0; index < lines.length && matches.length < maxMatches; index += 1) {
    if (Date.now() > deadline) {
      throw new Error(`grep pattern timed out after ${GREP_REGEX_TIMEOUT_MS}ms`);
    }
    regex.lastIndex = 0;
    if (regex.test(lines[index])) {
      matchedFiles.add(rel);
      matches.push(`${rel}:${index + 1}: ${lines[index]}`);
    }
  }
}

function clippedPreview(line: string, matchIndex: number, matchLength: number): { text: string; clipped: boolean } {
  if (line.length <= GREP_MAX_LINE_CHARS) return { text: line, clipped: false };
  const room = Math.floor((GREP_MAX_LINE_CHARS - Math.min(matchLength, GREP_MAX_LINE_CHARS)) / 2);
  let start = Math.max(0, Math.min(matchIndex - room, line.length - GREP_MAX_LINE_CHARS));
  if (start > 0 && /[\uDC00-\uDFFF]/u.test(line[start])) start -= 1;
  let end = Math.min(line.length, start + GREP_MAX_LINE_CHARS);
  if (end < line.length && /[\uD800-\uDBFF]/u.test(line[end - 1])) end -= 1;
  const text = `${start > 0 ? '…' : ''}${line.slice(start, end)}${end < line.length ? '…' : ''}`;
  return { text: `${text} [line preview clipped; full line searched]`, clipped: true };
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new Error('Aborted');
  }
}
