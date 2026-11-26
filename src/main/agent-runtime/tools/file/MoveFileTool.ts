import * as fs from 'fs/promises';
import * as path from 'path';
import {
  assertFileSizeCap,
  isPathExisting,
  requireMutationWorkspaceRoot,
  safeResolvePath,
} from '../../../runtime/toolFiles';
import { COPY_MOVE_MAX_BYTES } from '../../../runtime/toolLimits';
import { renameWithRetry } from '../../../platform/fileRename';
import type { AgentTool } from '../../agent/AgentTool';

interface MoveFileParams {
  source: string;
  destination: string;
}

interface MoveFileDetails {
  source: string;
  destination: string;
  overwritten: boolean;
}

export const moveFileTool: AgentTool<MoveFileParams, MoveFileDetails> = {
  name: 'move_file',
  label: '移动文件',
  description:
    'Move or rename a file inside the workspace. Creates parent directories if needed. Fails closed when destination already exists.',
  parameters: {
    type: 'object',
    properties: {
      source: { type: 'string', description: 'Source file path (relative or absolute inside workspace).' },
      destination: { type: 'string', description: 'Destination file path (relative or absolute inside workspace).' },
    },
    required: ['source', 'destination'],
  },
  spec: {
    isReadOnly: false,
    concurrency: 'exclusive',
    isDestructive: true,
    sideEffect: 'filesystem',
    category: 'file',
    requiresApproval: true,
  },
  permissionHint: 'mutation',
  effects: { writes: ['source', 'destination'] },

  async execute(_toolCallId, params, signal, _onUpdate, context) {
    if (signal?.aborted) throw new Error('Aborted');
    const workspaceRoot = requireMutationWorkspaceRoot(context);
    const src = safeResolvePath(params.source, workspaceRoot, context);
    const dest = safeResolvePath(params.destination, workspaceRoot, context);
    assertFileSizeCap(src, COPY_MOVE_MAX_BYTES, 'Source file');
    const destDir = path.dirname(dest);
    await fs.mkdir(destDir, { recursive: true });
    if (isPathExisting(dest)) {
      throw new Error(`Destination already exists; refusing overwrite: ${dest}`);
    }
    await renameWithRetry(src, dest);
    return {
      content: [{ type: 'text', text: `Moved ${src} → ${dest}` }],
      details: { source: src, destination: dest, overwritten: false },
    };
  },
};
