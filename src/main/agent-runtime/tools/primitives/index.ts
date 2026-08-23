/**
 * Primitive 工具集合统一导出。
 */
export { shellTool } from './ShellTool';
export { readFileTool } from './ReadFileTool';
export { readImageTool } from './ReadImageTool';
export { codeInterpreterTool } from './CodeInterpreterTool';
export { writeFileTool } from './WriteFileTool';
export { editFileTool } from './EditFileTool';
export { globTool } from './GlobTool';
export { grepTool } from './GrepTool';
export { gitAddTool, gitCommitTool, gitDiffTool, gitLogTool, gitStatusTool, gitUnstageTool } from './GitTool';
export { webFetchTool, webSearchTool } from './WebTools';
export { assertTextReadable, truncateOutput } from './_shared';
export { matchShellHardDeny } from './shellHardDeny';
export * from './toolLimits';

import type { AgentTool } from '../../agent/AgentTool';
import { shellTool } from './ShellTool';
import { readFileTool } from './ReadFileTool';
import { readImageTool } from './ReadImageTool';
import { codeInterpreterTool } from './CodeInterpreterTool';
import { writeFileTool } from './WriteFileTool';
import { editFileTool } from './EditFileTool';
import { globTool } from './GlobTool';
import { grepTool } from './GrepTool';
import { gitAddTool, gitCommitTool, gitDiffTool, gitLogTool, gitStatusTool, gitUnstageTool } from './GitTool';
import { webFetchTool, webSearchTool } from './WebTools';
import { deleteFileTool, moveFileTool, copyFileTool } from '../file';
import { notebookEditTool } from '../system';

/** 获取所有内置 primitive 工具。 */
export function getPrimitiveTools(): AgentTool[] {
  return [
    shellTool as unknown as AgentTool,
    readFileTool as unknown as AgentTool,
    readImageTool as unknown as AgentTool,
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
    notebookEditTool as unknown as AgentTool,
    codeInterpreterTool as unknown as AgentTool,
  ];
}
