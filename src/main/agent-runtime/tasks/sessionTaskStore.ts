/**
 * 会话级任务存储解析。
 *
 * 顶层 agent 的任务按会话隔离，落盘于 `workspace/.tasks/{sessionId}/`，
 * 使右侧「进度」泳道能够按当前会话读取 TaskRegistry 任务，互不串扰。
 * subagent 仍用 MemoryTaskStore（随子 context 结束回收），不经过本模块。
 */

import * as path from 'path';
import { storageAdapter } from '../../sessions/StorageAdapter';
import { FileTaskStore } from './TaskStore';

/** 将 sessionId 归一化为文件系统安全的目录名。 */
function safeSegment(sessionId: string): string {
  return sessionId.replace(/[^\w.-]/g, '_');
}

/** 解析会话级任务目录：`workspace/.tasks/{sessionId}`。 */
export function resolveSessionTasksDir(sessionId: string): string {
  return path.join(storageAdapter.getWorkspacePath(), '.tasks', safeSegment(sessionId));
}

/** 创建会话级 FileTaskStore（写入方与投影读取方共用同一路径规则）。 */
export function createSessionTaskStore(sessionId: string): FileTaskStore {
  return new FileTaskStore(resolveSessionTasksDir(sessionId));
}
