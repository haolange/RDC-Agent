/**
 * 会话级任务存储解析。
 *
 * 顶层 agent 的任务按会话隔离，落盘于 `${userData}/state/tasks/{sessionId}/`，
 * 使右侧「进度」泳道能够按当前会话读取 TaskRegistry 任务，互不串扰。
 * Task-owned delegated subagent uses its owner session's store through a scoped
 * runtime binding. A purely ephemeral child without a Task owner uses memory.
 */

import * as path from 'path';
import { appPathService } from '../../runtime/AppPathService';
import { FileTaskStore } from './TaskStore';

/** 将 sessionId 归一化为文件系统安全的目录名。 */
function safeSegment(sessionId: string): string {
  return sessionId.replace(/[^\w.-]/g, '_');
}

/** 解析会话级任务目录：`${userData}/state/tasks/{sessionId}`。 */
export function resolveSessionTasksDir(sessionId: string): string {
  return path.join(appPathService.getAppStatePaths().tasksPath, safeSegment(sessionId));
}

/** 创建会话级 FileTaskStore（写入方与投影读取方共用同一路径规则）。 */
export function createSessionTaskStore(sessionId: string): FileTaskStore {
  return new FileTaskStore(resolveSessionTasksDir(sessionId));
}
