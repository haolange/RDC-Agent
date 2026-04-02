/**
 * SystemTools - Layer 2 内置系统工具
 * 
 * 提供以下工具类别：
 * - FsTools: fs.read, fs.glob, fs.grep
 * - WebTools: web.fetch, web.search
 * - BashTools: bash.exec
 * - TaskTools: task.create, task.update, task.list
 */

import { DynamicStructuredTool } from '@langchain/core/tools';
import { createFsTools } from './FsTools';
import { createWebTools } from './WebTools';
import { createBashTools } from './BashTools';
import { createTaskTools } from './TaskTools';

export interface SystemToolsConfig {
  /** 工作区路径，用于限制文件系统访问范围 */
  workspacePath: string;
}

/**
 * 创建所有系统工具
 * @param config 系统工具配置
 * @returns DynamicStructuredTool 数组
 */
export function createSystemTools(config: SystemToolsConfig): DynamicStructuredTool[] {
  return [
    ...createFsTools(config.workspacePath),
    ...createWebTools(),
    ...createBashTools(config.workspacePath),
    ...createTaskTools(),
  ];
}

// 导出各个工具创建函数
export { createFsTools, createWebTools, createBashTools, createTaskTools };

// 从子模块导出类型
export type { SubTask, TaskStatus } from './TaskTools';
export { getTaskStore, clearAllTasks, getTask } from './TaskTools';
