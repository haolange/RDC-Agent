/**
 * Primitive 工具集合统一导出。
 */
export { bashTool } from './BashTool';
export { readFileTool } from './ReadFileTool';
export { writeFileTool } from './WriteFileTool';
export { editFileTool } from './EditFileTool';
export { globTool } from './GlobTool';

import type { AgentTool } from '../../agent/AgentTool';
import { bashTool } from './BashTool';
import { readFileTool } from './ReadFileTool';
import { writeFileTool } from './WriteFileTool';
import { editFileTool } from './EditFileTool';
import { globTool } from './GlobTool';

/** 获取所有内置 primitive 工具。 */
export function getPrimitiveTools(): AgentTool[] {
  return [
    bashTool as AgentTool,
    readFileTool as AgentTool,
    writeFileTool as AgentTool,
    editFileTool as AgentTool,
    globTool as AgentTool,
  ];
}
