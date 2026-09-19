/**
 * ReadFileTool — 读取 workspace 内的文本文件。
 *
 * 支持按行 offset / limit 分段读取（offset 从 1 起，limit 默认 2000 行）。
 * 二进制 / `.rdc` / 超大文件 fail-closed；按行窗口流式读取避免整文件入内存。
 */

import * as fs from 'fs';
import { recordSuccessfulFileRead } from './fileReadAccess';
import * as readline from 'readline';
import type { AgentTool } from '../../agent/AgentTool';
import { assertTextReadable, safeResolvePath, truncateOutput } from './_shared';
import {
  READ_FILE_DEFAULT_LIMIT,
  READ_FILE_MAX_LIMIT,
  READ_FILE_MAX_OUTPUT_BYTES,
  TEXT_FILE_MAX_BYTES,
} from './toolLimits';

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

export const readFileTool: AgentTool<ReadFileParams, ReadFileDetails> = {
  name: 'read_file',
  label: '读取文件',
  description:
    'Read the contents of a text file in the workspace. A successful uncancelled read permits later edit_file or overwrite of this realpath in the same session. Supports line offset (1-based) and limit. Default limit is 2000 lines. Binary files and RenderDoc .rdc captures are rejected.',
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
        description: `Maximum number of lines to read (default: ${READ_FILE_DEFAULT_LIMIT}, max: ${READ_FILE_MAX_LIMIT}).`,
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
    assertTextReadable(absolute, { maxBytes: TEXT_FILE_MAX_BYTES });

    const offset = Math.max(1, Math.floor(params.offset ?? 1));
    const limit = Math.max(
      1,
      Math.min(READ_FILE_MAX_LIMIT, Math.floor(params.limit ?? READ_FILE_DEFAULT_LIMIT)),
    );

    const { lines, totalLines, hitEof } = await readLineWindow(absolute, offset, limit, signal);
    if (signal?.aborted) {
      throw new Error('Aborted');
    }

    const startIdx = offset - 1;
    const numbered = lines
      .map((line, i) => `${String(startIdx + i + 1).padStart(6, ' ')}→${line}`)
      .join('\n');

    const text = truncateOutput(numbered, READ_FILE_MAX_OUTPUT_BYTES);
    const truncated =
      Buffer.byteLength(numbered, 'utf8') > READ_FILE_MAX_OUTPUT_BYTES
      || !hitEof
      || lines.length < Math.min(limit, Math.max(0, totalLines - startIdx));

    recordSuccessfulFileRead(absolute, context);
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

async function readLineWindow(
  absolute: string,
  offset: number,
  limit: number,
  signal?: AbortSignal,
): Promise<{ lines: string[]; totalLines: number; hitEof: boolean }> {
  const stream = fs.createReadStream(absolute, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  const lines: string[] = [];
  let lineNo = 0;

  try {
    for await (const line of rl) {
      if (signal?.aborted) {
        throw new Error('Aborted');
      }
      lineNo += 1;
      if (lineNo < offset) continue;
      if (lines.length < limit) {
        lines.push(line);
      }
    }
  } finally {
    rl.close();
    stream.destroy();
  }

  const lastCaptured = offset - 1 + lines.length;
  return {
    lines,
    totalLines: lineNo,
    hitEof: lastCaptured >= lineNo,
  };
}
