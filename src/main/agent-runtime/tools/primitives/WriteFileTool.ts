/**
 * WriteFileTool — 在 workspace 内写入文本文件。
 *
 * - 父目录不存在时递归创建。
 * - 文件存在时直接覆盖。
 * - 路径越界时抛错。
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import type { AgentTool } from '../../agent/AgentTool';
import { safeResolvePath } from './_shared';

interface WriteFileParams {
  path: string;
  content: string;
}

interface WriteFileDetails {
  path: string;
  bytesWritten: number;
  created: boolean;
}

export const writeFileTool: AgentTool<WriteFileParams, WriteFileDetails> = {
  name: 'write_file',
  label: '写入文件',
  description:
    'Write content to a file inside the workspace. Creates the file (and parent directories) if needed; overwrites if it exists.',
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
  spec: { isReadOnly: false, isConcurrencySafe: false, isDestructive: false, sideEffect: 'filesystem', category: 'file', requiresApproval: true },
  permissionHint: 'mutation',

  async execute(_toolCallId, params, signal) {
    if (signal?.aborted) {
      throw new Error('Aborted');
    }

    const absolute = safeResolvePath(params.path);
    const dir = path.dirname(absolute);

    let created = true;
    try {
      await fs.access(absolute);
      created = false;
    } catch {
      created = true;
    }

    await fs.mkdir(dir, { recursive: true });
    if (signal?.aborted) {
      throw new Error('Aborted');
    }
    await fs.writeFile(absolute, params.content, 'utf8');

    const bytesWritten = Buffer.byteLength(params.content, 'utf8');
    const text = `${created ? 'Created' : 'Overwrote'} ${absolute} (${bytesWritten} bytes)`;

    return {
      content: [{ type: 'text', text }],
      details: {
        path: absolute,
        bytesWritten,
        created,
      },
    };
  },
};
