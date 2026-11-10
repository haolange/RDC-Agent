/**
 * 会话级任务存储解析。
 *
 * 顶层 agent 的任务按会话隔离，落盘于 `${userData}/state/tasks/{sessionId}/`，
 * 使右侧「进度」泳道能够按当前会话读取 TaskRegistry 任务，互不串扰。
 * Task-owned delegated subagent uses its owner session's store through a scoped
 * runtime binding. A purely ephemeral child without a Task owner uses memory.
 */

import * as fs from 'fs';
import * as path from 'path';
import { childScopePrefix, isTransientScopeId } from '@shared/utils/executionScope';
import { appPathService } from '../../runtime/AppPathService';
import { FileTaskStore, MemoryTaskStore, type TaskStore } from './TaskStore';
import { verifyTaskReviewArtifact } from './TaskReviewArtifact';

/** 将 sessionId 归一化为文件系统安全的目录名。 */
function safeSegment(sessionId: string): string {
  return sessionId.replace(/[^\w.-]/g, '_');
}

/** 解析会话级任务目录：`${userData}/state/tasks/{sessionId}`。 */
export function resolveSessionTasksDir(sessionId: string): string {
  return path.join(appPathService.getAppStatePaths().tasksPath, safeSegment(sessionId));
}

/** Remove only the deleted session's own and nested child Task scopes. */
export function removeSessionTasks(sessionId: string): void {
  const base = appPathService.getAppStatePaths().tasksPath;
  if (!fs.existsSync(base)) return;
  const own = safeSegment(sessionId);
  const childPrefix = safeSegment(childScopePrefix(sessionId));
  const entries = fs.readdirSync(base, { withFileTypes: true })
    .filter(entry => entry.name === own || entry.name.startsWith(childPrefix));
  if (entries.some(entry => !entry.isDirectory())) throw new Error('TASK_SCOPE_NOT_DIRECTORY');
  for (const entry of entries) fs.rmSync(path.join(base, entry.name), { recursive: true, force: true });
}

/** 创建会话级 FileTaskStore（写入方与投影读取方共用同一路径规则）。 */
export function createSessionTaskStore(sessionId: string): FileTaskStore {
  return new FileTaskStore(resolveSessionTasksDir(sessionId), async () => {
    const { readApprovedPlanTasks } = await import('../../sessions/run/ApprovedPlanTasks');
    return readApprovedPlanTasks(sessionId);
  }, async (uri, hash) => {
    const { sessionArtifactResolver } = await import('../../sessions/artifacts/SessionArtifactResolver');
    const { investigationArtifactService } = await import('../../investigation/InvestigationArtifactService');
    return verifyTaskReviewArtifact(sessionId, uri, hash, sessionArtifactResolver, investigationArtifactService);
  }, async (epoch, preparation) => {
    try {
      const { rdcLifecycleReceipts } = await import('../../rdc/RdcLifecycleReceipts');
      const receipt = rdcLifecycleReceipts.read(sessionId, epoch.receipt);
      return receipt.event === 'transition' && receipt.sessionId === preparation.sessionId && receipt.turnId === preparation.turnId
        && receipt.previousFingerprint === epoch.previousFingerprint && receipt.runtimeFingerprint === epoch.runtimeFingerprint
        && receipt.recordedAt === epoch.recordedAt;
    } catch { return false; }
  });
}

const memoryStores = new Map<string, MemoryTaskStore>();

/**
 * Durable sessions use the session file store. Ephemeral and subagent scopes
 * share one in-memory store for that scope until `releaseScopeTaskStore`.
 * A Task-owned child keeps using its owner session store.
 */
export function taskStoreForExecutionScope(
  scopeId: string | null,
  delegatedOwnerSessionId?: string | null,
  durable: (sessionId: string) => TaskStore = createSessionTaskStore,
): TaskStore {
  if (delegatedOwnerSessionId) return durable(delegatedOwnerSessionId);
  if (scopeId && !isTransientScopeId(scopeId)) return durable(scopeId);
  if (!scopeId) return new MemoryTaskStore();
  const existing = memoryStores.get(scopeId);
  if (existing) return existing;
  const created = new MemoryTaskStore();
  memoryStores.set(scopeId, created);
  return created;
}

export function releaseScopeTaskStore(scopeId: string): void {
  memoryStores.delete(scopeId);
}
