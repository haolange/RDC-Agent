import * as fs from 'fs/promises';
import * as path from 'path';
import type { AgentTool } from '../../agent/AgentTool';
import { assertFileSizeCap, assertTextReadable, requireMutationWorkspaceRoot, safeResolvePath, writeTextFileNoFollow } from '../primitives/_shared';
import { NOTEBOOK_MAX_BYTES } from '../primitives/toolLimits';

interface NotebookEditParams {
  notebook_path: string;
  cell_index: number;
  new_source: string;
}

interface NotebookEditDetails {
  notebook_path: string;
  cell_index: number;
  old_length: number;
  new_length: number;
}

export const notebookEditTool: AgentTool<NotebookEditParams, NotebookEditDetails> = {
  name: 'notebook_edit',
  label: '编辑 Notebook',
  description: 'Edit a single cell in a Jupyter notebook file (JSON .ipynb).',
  parameters: {
    type: 'object',
    properties: {
      notebook_path: { type: 'string', description: 'Path to the .ipynb file inside the workspace.' },
      cell_index: { type: 'integer', description: 'Zero-based index of the cell to edit.' },
      new_source: { type: 'string', description: 'New source content for the cell.' },
    },
    required: ['notebook_path', 'cell_index', 'new_source'],
  },
  spec: { isReadOnly: false, isConcurrencySafe: false, isDestructive: false, sideEffect: 'filesystem', category: 'file', requiresApproval: true },
  permissionHint: 'mutation',

  async execute(_toolCallId, params, signal, _onUpdate, context) {
    if (signal?.aborted) throw new Error('Aborted');
    const workspaceRoot = requireMutationWorkspaceRoot(context);
    const absolute = safeResolvePath(params.notebook_path, workspaceRoot, context);
    if (path.extname(absolute).toLowerCase() !== '.ipynb') {
      throw new Error(`notebook_edit requires a .ipynb file: ${absolute}`);
    }
    assertFileSizeCap(absolute, NOTEBOOK_MAX_BYTES, 'Notebook');
    assertTextReadable(absolute, { maxBytes: NOTEBOOK_MAX_BYTES });

    const raw = await fs.readFile(absolute, 'utf8');
    const notebook = JSON.parse(raw) as { cells?: Array<{ source: string | string[] }> };
    if (!Array.isArray(notebook.cells)) {
      throw new Error('Invalid notebook: missing cells array');
    }
    const idx = params.cell_index;
    if (idx < 0 || idx >= notebook.cells.length) {
      throw new Error(`Cell index ${idx} out of range (0..${notebook.cells.length - 1})`);
    }
    const cell = notebook.cells[idx];
    const oldSource = Array.isArray(cell.source) ? cell.source.join('') : String(cell.source ?? '');
    // Preserve Jupyter array source shape when the cell originally used string[].
    cell.source = Array.isArray(cell.source)
      ? params.new_source.split(/(?<=\n)/)
      : params.new_source;
    await writeTextFileNoFollow(absolute, JSON.stringify(notebook, null, 2));
    return {
      content: [{ type: 'text', text: `Edited cell ${idx} in ${absolute}` }],
      details: {
        notebook_path: absolute,
        cell_index: idx,
        old_length: oldSource.length,
        new_length: params.new_source.length,
      },
    };
  },
};
