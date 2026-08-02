/**
 * WriteFileTool — 在 workspace 内写入文本文件。
 *
 * - 父目录不存在时递归创建。
 * - 文件存在时覆盖（details.overwritten / isDestructive）。
 * - content 有字节上限；拒写目录路径。
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import type { AgentTool } from '../../agent/AgentTool';
import { isPathExisting, requireMutationWorkspaceRoot, safeResolvePath, writeTextFileNoFollow } from './_shared';
import { WRITE_FILE_MAX_CONTENT_BYTES } from './toolLimits';

interface WriteFileParams {
  path: string;
  content: string;
}

interface WriteFileDetails {
  path: string;
  bytesWritten: number;
  created: boolean;
  overwritten: boolean;
}

export const writeFileTool: AgentTool<WriteFileParams, WriteFileDetails> = {
  name: 'write_file',
  label: '写入文件',
  description:
    'Write content to a text file inside the workspace. Creates the file (and parent directories) if needed; overwrites if it exists.',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Target file path (relative or absolute, must be inside workspace).',
      },
      content: {
        type: 'string',
        description: 'Full file content to write.',
      },
    },
    required: ['path', 'content'],
  },
  spec: { isReadOnly: false, isConcurrencySafe: false, isDestructive: true, sideEffect: 'filesystem', category: 'file', requiresApproval: true },
  permissionHint: 'mutation',

  async execute(_toolCallId, params, signal, _onUpdate, context) {
    if (signal?.aborted) {
      throw new Error('Aborted');
    }

    const content = typeof params.content === 'string' ? params.content : '';
    const bytesWritten = Buffer.byteLength(content, 'utf8');
    if (bytesWritten > WRITE_FILE_MAX_CONTENT_BYTES) {
      throw new Error(
        `write_file content exceeds limit (${bytesWritten} > ${WRITE_FILE_MAX_CONTENT_BYTES} bytes)`,
      );
    }

    const workspaceRoot = requireMutationWorkspaceRoot(context);
    const absolute = safeResolvePath(params.path, workspaceRoot, context);
    const dir = path.dirname(absolute);

    if (isPathExisting(absolute)) {
      const stat = await fs.stat(absolute);
      if (stat.isDirectory()) {
        throw new Error(`Refusing to write to directory path: ${absolute}`);
      }
    }

    const existed = isPathExisting(absolute);
    await fs.mkdir(dir, { recursive: true });
    if (signal?.aborted) {
      throw new Error('Aborted');
    }
    await writeTextFileNoFollow(absolute, content);

    const created = !existed;
    const overwritten = existed;
    const text = `${created ? 'Created' : 'Overwrote'} ${absolute} (${bytesWritten} bytes)`;

    return {
      content: [{ type: 'text', text }],
      details: {
        path: absolute,
        bytesWritten,
        created,
        overwritten,
      },
    };
  },
};
