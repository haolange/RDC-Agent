import * as fs from 'fs/promises';
import type { AgentTool } from '../../agent/AgentTool';
import { safeResolvePath } from '../primitives/_shared';

interface DeleteFileParams {
  path: string;
}

interface DeleteFileDetails {
  path: string;
  existed: boolean;
}

export const deleteFileTool: AgentTool<DeleteFileParams, DeleteFileDetails> = {
  name: 'delete_file',
  label: '删除文件',
  description: 'Delete a file inside the workspace. Returns whether the file existed before deletion.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Relative or absolute path inside the workspace.' },
    },
    required: ['path'],
  },
  spec: { isReadOnly: false, isConcurrencySafe: false, isDestructive: true, sideEffect: 'filesystem', category: 'file', requiresApproval: true },
  permissionHint: 'destructive',

  async execute(_toolCallId, params, signal, _onUpdate, context) {
    if (signal?.aborted) throw new Error('Aborted');
    const absolute = safeResolvePath(params.path, undefined, context);
    let existed = false;
    try {
      await fs.access(absolute);
      existed = true;
    } catch { /* no-op */ }
    if (existed) {
      await fs.unlink(absolute);
    }
    return {
      content: [{ type: 'text', text: `${existed ? 'Deleted' : 'Did not exist'}: ${absolute}` }],
      details: { path: absolute, existed },
    };
  },
};
