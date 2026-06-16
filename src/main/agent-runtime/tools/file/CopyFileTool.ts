import * as fs from 'fs/promises';
import * as path from 'path';
import type { AgentTool } from '../../agent/AgentTool';
import { safeResolvePath } from '../primitives/_shared';

interface CopyFileParams {
  source: string;
  destination: string;
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
  description: 'Copy a file inside the workspace. Creates parent directories if needed.',
  parameters: {
    type: 'object',
    properties: {
      source: { type: 'string', description: 'Source file path (relative or absolute inside workspace).' },
      destination: { type: 'string', description: 'Destination file path (relative or absolute inside workspace).' },
    },
    required: ['source', 'destination'],
  },
  spec: { isReadOnly: false, isConcurrencySafe: false, isDestructive: false, sideEffect: 'filesystem', category: 'file', requiresApproval: true },
  permissionHint: 'mutation',

  async execute(_toolCallId, params, signal) {
    if (signal?.aborted) throw new Error('Aborted');
    const src = safeResolvePath(params.source);
    const dest = safeResolvePath(params.destination);
    const destDir = path.dirname(dest);
    await fs.mkdir(destDir, { recursive: true });
    let overwritten = false;
    try {
      await fs.access(dest);
      overwritten = true;
    } catch { /* no-op */ }
    await fs.copyFile(src, dest);
    const stat = await fs.stat(src);
    return {
      content: [{ type: 'text', text: `Copied ${src} → ${dest}${overwritten ? ' (overwrote existing)' : ''} (${stat.size} bytes)` }],
      details: { source: src, destination: dest, overwritten, bytes: stat.size },
    };
  },
};
