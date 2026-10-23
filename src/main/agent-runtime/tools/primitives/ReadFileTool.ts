/**
 * ReadFileTool — 读取 workspace 内的文本文件。
 *
 * 支持按行 offset / limit 分段读取（offset 从 1 起，limit 默认 2000 行）。
 * 默认文本读取拒绝二进制；显式 audit 核对有限大小的实际文件字节。
 * `.rdc` / 超大文件始终 fail-closed；文本按行窗口流式读取。
 */

import * as fs from 'fs';
import { createHash } from 'node:crypto';
import { recordSuccessfulFileRead } from './fileReadAccess';
import { auditFiles, type FileAuditDetails, type FileAuditParams } from './fileAudit';
import * as readline from 'readline';
import type { AgentTool } from '../../agent/AgentTool';
import { assertTextReadable, safeResolvePath, truncateOutput } from './_shared';
import {
  READ_FILE_DEFAULT_LIMIT,
  READ_FILE_MAX_LIMIT,
  READ_FILE_MAX_OUTPUT_BYTES,
  TEXT_FILE_MAX_BYTES,
} from './toolLimits';

interface ReadFileParams extends FileAuditParams {
  mode?: 'text' | 'audit';
  pinEvidence?: boolean;
  offset?: number;
  limit?: number;
}

interface ReadFileDetails {
  path: string;
  bytes: number;
  sha256: string;
  totalLines: number;
  offset: number;
  limit: number;
  truncated: boolean;
}

export const readFileTool: AgentTool<ReadFileParams, ReadFileDetails | FileAuditDetails> = {
  name: 'read_file',
  label: '读取文件',
  description:
    'Read workspace text with whole-file SHA-256 and line windows. Default text mode rejects binary and grants read-before-edit after success. pinEvidence=true gives even a small returned window a durable session URI/hash for explicit delegation; it does not persist unread file content or grant child access. Explicit audit mode requires expectedHash, audits actual whole-file bytes (including binary), optionally compares a second hash-bound file and UTF-8 text with only CRLF converted to LF. Audit returns byte identities, first64-byte hex and bounded changed span, not domain validation or an edit grant. Both paths require read access. RenderDoc .rdc/magic always rejected; max8MiB per input. Audit forbids offset/limit.',
  parameters: {
    type: 'object',
    properties: {
      pinEvidence: { type: 'boolean', description: 'Opt in to a durable URI/hash for the returned text window, including small diffs. Default false avoids extra artifacts. Whole-file hash and totalLines do not mean the displayed window is complete; inspect truncated and page all required content. Explicit child grants remain required.' },
      path: {
        type: 'string',
        description: 'Relative or absolute path inside the workspace.',
      },
      mode: { type: 'string', enum: ['text', 'audit'], description: 'Default text; audit performs a bounded hash-bound whole-file computation without reading full content into model context.' },
      expectedHash: { type: 'string', description: 'Audit only: exact input SHA-256, optional sha256: prefix; mismatch fails closed.' },
      compareWith: {
        type: 'object', additionalProperties: false,
        properties: { path: { type: 'string' }, expectedHash: { type: 'string' } },
        required: ['path', 'expectedHash'],
        description: 'Audit only: second independently authorized, hash-bound input. Reports actual byte equality.',
      },
      textComparison: { type: 'boolean', description: 'Audit only: require valid NUL-free UTF-8, preserve BOM/bare CR, normalize only CRLF to LF. Return normalized hashes and common prefix/suffix line counts plus bounded middle spans. A truncated middle is not a full diff; hashes/equality still cover complete inputs.' },
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

    if (params.mode === 'audit') {
      if (params.offset !== undefined || params.limit !== undefined) throw new Error('FILE_AUDIT_PAGING_DENIED');
      const details = await auditFiles(params, context, signal);
      return { content: [{ type: 'text', text: JSON.stringify(details) }], details };
    }
    if ((params.mode !== undefined && params.mode !== 'text') || params.expectedHash !== undefined
      || params.compareWith !== undefined || params.textComparison !== undefined) {
      throw new Error('FILE_READ_MODE_INVALID: audit options require explicit mode=audit.');
    }

    const absolute = safeResolvePath(params.path, undefined, context);
    assertTextReadable(absolute, { maxBytes: TEXT_FILE_MAX_BYTES });

    const offset = Math.max(1, Math.floor(params.offset ?? 1));
    const limit = Math.max(
      1,
      Math.min(READ_FILE_MAX_LIMIT, Math.floor(params.limit ?? READ_FILE_DEFAULT_LIMIT)),
    );

    const { lines, totalLines, hitEof, bytes, sha256 } = await readLineWindow(absolute, offset, limit, signal);
    if (signal?.aborted) {
      throw new Error('Aborted');
    }

    const startIdx = offset - 1;
    const numbered = lines
      .map((line, i) => `${String(startIdx + i + 1).padStart(6, ' ')}→${line}`)
      .join('\n');

    const display = `Whole file: ${bytes} bytes · sha256=${sha256}\nDisplayed ${lines.length} lines starting at ${offset} (line numbers are not file bytes).\n\n${numbered}`;
    const text = truncateOutput(display, READ_FILE_MAX_OUTPUT_BYTES);
    const truncated =
      Buffer.byteLength(display, 'utf8') > READ_FILE_MAX_OUTPUT_BYTES
      || !hitEof
      || lines.length < Math.min(limit, Math.max(0, totalLines - startIdx));

    recordSuccessfulFileRead(absolute, context);
    return {
      content: [{ type: 'text', text }],
      details: {
        path: absolute,
        bytes,
        sha256,
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
): Promise<{ lines: string[]; totalLines: number; hitEof: boolean; bytes: number; sha256: string }> {
  const hash = createHash('sha256');
  let bytes = 0;
  const stream = fs.createReadStream(absolute);
  stream.on('data', (chunk: string | Buffer) => {
    hash.update(chunk);
    bytes += Buffer.byteLength(chunk);
  });
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
    bytes,
    sha256: hash.digest('hex'),
  };
}
