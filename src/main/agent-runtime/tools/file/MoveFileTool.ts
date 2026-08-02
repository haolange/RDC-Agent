import * as fs from 'fs/promises';
import * as path from 'path';
import type { AgentTool } from '../../agent/AgentTool';
import { assertFileSizeCap, isPathExisting, requireMutationWorkspaceRoot, safeResolvePath } from '../primitives/_shared';
import { COPY_MOVE_MAX_BYTES } from '../primitives/toolLimits';

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
  spec: { isReadOnly: false, isConcurrencySafe: false, isDestructive: true, sideEffect: 'filesystem', category: 'file', requiresApproval: true },
  permissionHint: 'mutation',

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
    await fs.rename(src, dest);
    return {
      content: [{ type: 'text', text: `Moved ${src} → ${dest}` }],
      details: { source: src, destination: dest, overwritten: false },
    };
  },
};
