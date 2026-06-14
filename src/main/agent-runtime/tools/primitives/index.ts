/**
 * Primitive 工具集合统一导出。
 */
export { bashTool } from './BashTool';
export { readFileTool } from './ReadFileTool';
export { writeFileTool } from './WriteFileTool';
export { editFileTool } from './EditFileTool';
export { globTool } from './GlobTool';
export { grepTool } from './GrepTool';
export { webFetchTool, webSearchTool } from './WebTools';
export { withTemporaryPathAccess } from './_shared';

import type { AgentTool } from '../../agent/AgentTool';
import { bashTool } from './BashTool';
import { readFileTool } from './ReadFileTool';
import { writeFileTool } from './WriteFileTool';
import { editFileTool } from './EditFileTool';
import { globTool } from './GlobTool';
import { grepTool } from './GrepTool';
import { webFetchTool, webSearchTool } from './WebTools';

/** 获取所有内置 primitive 工具。 */
export function getPrimitiveTools(): AgentTool[] {
  return [
    bashTool as unknown as AgentTool,
    readFileTool as unknown as AgentTool,
    writeFileTool as unknown as AgentTool,
    editFileTool as unknown as AgentTool,
    globTool as unknown as AgentTool,
    grepTool as unknown as AgentTool,
    webFetchTool as unknown as AgentTool,
    webSearchTool as unknown as AgentTool,
  ];
}
