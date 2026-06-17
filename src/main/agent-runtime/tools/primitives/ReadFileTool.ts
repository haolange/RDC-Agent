/**
 * ReadFileTool — 读取 workspace 内的文本文件。
 *
 * 支持按行 offset / limit 分段读取（offset 从 1 起，limit 默认 2000 行）。
 * 文件不存在或越界时返回错误结果（由 ToolRegistry 处理 throw）。
 */

import * as fs from 'fs/promises';
import type { AgentTool } from '../../agent/AgentTool';
import { safeResolvePath, truncateOutput } from './_shared';

interface ReadFileParams {
  path: string;
  offset?: number;
  limit?: number;
}

interface ReadFileDetails {
  path: string;
  totalLines: number;
  offset: number;
  limit: number;
  truncated: boolean;
}

const DEFAULT_LIMIT = 2000;
const MAX_OUTPUT_BYTES = 200 * 1024;

export const readFileTool: AgentTool<ReadFileParams, ReadFileDetails> = {
  name: 'read_file',
  label: '读取文件',
  description:
    'Read the contents of a file in the workspace. Supports line offset (1-based) and limit. Default limit is 2000 lines.',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Relative or absolute path inside the workspace.',
      },
      offset: {
        type: 'integer',
        description: 'Start line number (1-based, default: 1).',
      },
      limit: {
        type: 'integer',
        description: 'Maximum number of lines to read (default: 2000).',
      },
    },
    required: ['path'],
  },
  spec: { isReadOnly: true, isConcurrencySafe: true, isDestructive: false, sideEffect: 'none', category: 'file', requiresApproval: false },
  permissionHint: 'readonly',

  async execute(_toolCallId, params, signal, _onUpdate, context) {
    if (signal?.aborted) {
      throw new Error('Aborted');
    }

    const absolute = safeResolvePath(params.path, undefined, context);
    const offset = Math.max(1, Math.floor(params.offset ?? 1));
    const limit = Math.max(1, Math.floor(params.limit ?? DEFAULT_LIMIT));

    const raw = await fs.readFile(absolute, 'utf8');
    if (signal?.aborted) {
      throw new Error('Aborted');
    }
    const lines = raw.split(/\r?\n/);
    const totalLines = lines.length;

    const startIdx = offset - 1;
    const endIdx = Math.min(totalLines, startIdx + limit);
    const slice = lines.slice(startIdx, endIdx);

    const numbered = slice
      .map((line, i) => `${String(startIdx + i + 1).padStart(6, ' ')}→${line}`)
      .join('\n');

    const text = truncateOutput(numbered, MAX_OUTPUT_BYTES);
    const truncated =
      Buffer.byteLength(numbered, 'utf8') > MAX_OUTPUT_BYTES ||
      endIdx < totalLines;

    return {
      content: [{ type: 'text', text }],
      details: {
        path: absolute,
        totalLines,
        offset,
        limit,
        truncated,
      },
    };
  },
};
