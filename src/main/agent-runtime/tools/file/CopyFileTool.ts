import * as fs from 'fs/promises';
import * as path from 'path';
import type { AgentTool } from '../../agent/AgentTool';
import { assertFileSizeCap, isPathExisting, safeResolvePath } from '../primitives/_shared';
import { COPY_MOVE_MAX_BYTES } from '../primitives/toolLimits';

interface CopyFileParams {
  source: string;
  destination: string;
  overwrite?: boolean;
}

interface CopyFileDetails {
  source: string;
  destination: string;
  overwritten: boolean;
  bytes: number;
}

export const copyFileTool: AgentTool<CopyFileParams, CopyFileDetails> = {
  name: 'copy_file',
  label: '复制文件',
  description:
    'Copy a file inside the workspace. Creates parent directories if needed. Refuses to overwrite unless overwrite=true.',
  parameters: {
    type: 'object',
    properties: {
      source: { type: 'string', description: 'Source file path (relative or absolute inside workspace).' },
      destination: { type: 'string', description: 'Destination file path (relative or absolute inside workspace).' },
      overwrite: {
        type: 'boolean',
        description: 'When true, allow replacing an existing destination file. Defaults to false.',
      },
    },
    required: ['source', 'destination'],
  },
  spec: { isReadOnly: false, isConcurrencySafe: false, isDestructive: true, sideEffect: 'filesystem', category: 'file', requiresApproval: true },
  permissionHint: 'mutation',

  async execute(_toolCallId, params, signal, _onUpdate, context) {
    if (signal?.aborted) throw new Error('Aborted');
    const src = safeResolvePath(params.source, undefined, context);
    const dest = safeResolvePath(params.destination, undefined, context);
    assertFileSizeCap(src, COPY_MOVE_MAX_BYTES, 'Source file');
    const destDir = path.dirname(dest);
    await fs.mkdir(destDir, { recursive: true });
    const destExists = isPathExisting(dest);
    if (destExists && params.overwrite !== true) {
      throw new Error(`Destination already exists (pass overwrite=true to replace): ${dest}`);
    }
    await fs.copyFile(src, dest);
    const stat = await fs.stat(src);
    return {
      content: [{
        type: 'text',
        text: `Copied ${src} → ${dest}${destExists ? ' (overwrote existing)' : ''} (${stat.size} bytes)`,
      }],
      details: { source: src, destination: dest, overwritten: destExists, bytes: stat.size },
    };
  },
};
