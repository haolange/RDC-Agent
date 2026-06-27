/**
 * Primitive 工具集合统一导出。
 */
export { bashTool } from './BashTool';
export { readFileTool } from './ReadFileTool';
export { writeFileTool } from './WriteFileTool';
export { editFileTool } from './EditFileTool';
export { globTool } from './GlobTool';
export { grepTool } from './GrepTool';
export { gitAddTool, gitCommitTool, gitDiffTool, gitLogTool, gitStatusTool, gitUnstageTool } from './GitTool';
export { webFetchTool, webSearchTool } from './WebTools';
export { withTemporaryPathAccess } from './_shared';

import type { AgentTool } from '../../agent/AgentTool';
import { bashTool } from './BashTool';
import { readFileTool } from './ReadFileTool';
import { writeFileTool } from './WriteFileTool';
import { editFileTool } from './EditFileTool';
import { globTool } from './GlobTool';
import { grepTool } from './GrepTool';
import { gitAddTool, gitCommitTool, gitDiffTool, gitLogTool, gitStatusTool, gitUnstageTool } from './GitTool';
import { webFetchTool, webSearchTool } from './WebTools';
import { deleteFileTool, moveFileTool, copyFileTool } from '../file';
import { searchCodebaseTool } from '../search';
import { askUserTool, notebookEditTool } from '../system';

/** 获取所有内置 primitive 工具。 */
export function getPrimitiveTools(): AgentTool[] {
  return [
    bashTool as unknown as AgentTool,
    readFileTool as unknown as AgentTool,
    writeFileTool as unknown as AgentTool,
    editFileTool as unknown as AgentTool,
    globTool as unknown as AgentTool,
    grepTool as unknown as AgentTool,
    gitStatusTool as unknown as AgentTool,
    gitDiffTool as unknown as AgentTool,
    gitLogTool as unknown as AgentTool,
    gitAddTool as unknown as AgentTool,
    gitUnstageTool as unknown as AgentTool,
    gitCommitTool as unknown as AgentTool,
    webFetchTool as unknown as AgentTool,
    webSearchTool as unknown as AgentTool,
    deleteFileTool as unknown as AgentTool,
    moveFileTool as unknown as AgentTool,
    copyFileTool as unknown as AgentTool,
    searchCodebaseTool as unknown as AgentTool,
    askUserTool as unknown as AgentTool,
    notebookEditTool as unknown as AgentTool,
  ];
}
