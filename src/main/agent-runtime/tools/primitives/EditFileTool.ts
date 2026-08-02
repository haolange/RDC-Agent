/**
 * EditFileTool — 基于 search/replace 的文件编辑。
 *
 * - 必须精确匹配 old_text；
 * - old_text 在文件中必须唯一出现（保护多处误改）；
 * - 二进制 / 超大文件 fail-closed。
 */

import * as fs from 'fs/promises';
import type { AgentTool } from '../../agent/AgentTool';
import { assertTextReadable, requireMutationWorkspaceRoot, safeResolvePath, writeTextFileNoFollow } from './_shared';
import { TEXT_FILE_MAX_BYTES } from './toolLimits';

interface EditFileParams {
  path: string;
  old_text: string;
  new_text: string;
}

interface EditFileDetails {
  path: string;
  oldLength: number;
  newLength: number;
  occurrence: number;
  /** 文件内容净增/减字节数（new - old）。 */
  delta: number;
}

export const editFileTool: AgentTool<EditFileParams, EditFileDetails> = {
  name: 'edit_file',
  label: '编辑文件',
  description:
    'Edit a text file by replacing old_text with new_text. The old_text must match exactly and appear exactly once in the file. Binary files are rejected.',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Target file path (relative or absolute, must be inside workspace).',
      },
      old_text: {
        type: 'string',
        description: 'The exact text to replace. Must match exactly and uniquely.',
      },
      new_text: {
        type: 'string',
        description: 'The replacement text.',
      },
    },
    required: ['path', 'old_text', 'new_text'],
  },
  spec: { isReadOnly: false, isConcurrencySafe: false, isDestructive: false, sideEffect: 'filesystem', category: 'file', requiresApproval: true },
  permissionHint: 'mutation',

  async execute(_toolCallId, params, signal, _onUpdate, context) {
    if (signal?.aborted) {
      throw new Error('Aborted');
    }

    if (params.old_text.length === 0) {
      throw new Error('old_text 不能为空');
    }
    if (params.old_text === params.new_text) {
      throw new Error('old_text 与 new_text 相同，无需编辑');
    }

    const workspaceRoot = requireMutationWorkspaceRoot(context);
    const absolute = safeResolvePath(params.path, workspaceRoot, context);
    assertTextReadable(absolute, { maxBytes: TEXT_FILE_MAX_BYTES });

    const original = await fs.readFile(absolute, 'utf8');
    if (signal?.aborted) {
      throw new Error('Aborted');
    }

    const firstIdx = original.indexOf(params.old_text);
    if (firstIdx < 0) {
      throw new Error('old_text 未在文件中找到');
    }
    const secondIdx = original.indexOf(
      params.old_text,
      firstIdx + params.old_text.length,
    );
    if (secondIdx >= 0) {
      throw new Error('old_text 在文件中出现多次，请提供更精确的上下文');
    }

    const updated =
      original.slice(0, firstIdx) +
      params.new_text +
      original.slice(firstIdx + params.old_text.length);

    await writeTextFileNoFollow(absolute, updated);

    const oldBytes = Buffer.byteLength(params.old_text, 'utf8');
    const newBytes = Buffer.byteLength(params.new_text, 'utf8');

    return {
      content: [
        {
          type: 'text',
          text: `Edited ${absolute}: replaced 1 occurrence (${oldBytes} → ${newBytes} bytes).`,
        },
      ],
      details: {
        path: absolute,
        oldLength: params.old_text.length,
        newLength: params.new_text.length,
        occurrence: 1,
        delta: newBytes - oldBytes,
      },
    };
  },
};
