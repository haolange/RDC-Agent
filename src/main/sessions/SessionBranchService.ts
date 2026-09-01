/**
 * SessionBranchService — 会话分支 (/branch)。
 *
 * 允许在当前位置分叉对话，创建独立的对话分支。
 */
import { createSessionWithHooks } from '../hooks/sessionLifecycle';
import { storageAdapter } from './StorageAdapter';
import type { SessionRecord } from '@shared/types/session';

export interface BranchResult { branchId: string; session: SessionRecord; }

export class SessionBranchService {
  /**
   * 在当前位置创建会话分支。
   * @param sourceSessionId 源会话 ID
   * @param branchName 分支名称
   * @returns 新会话记录
   */
  async createBranch(sourceSessionId: string, branchName?: string): Promise<BranchResult | null> {
    const source = storageAdapter.readSession(sourceSessionId);
    if (!source) return null;

    const title = branchName ?? `${source.title ?? 'session'} (branch)`;
    const branched = await createSessionWithHooks(source.projectId, title);

    // 复制源会话的消息到分支
    const sourceMessages = storageAdapter.readConversationHistory(sourceSessionId);
    if (sourceMessages) {
      for (const msg of sourceMessages) {
        // 这里简化处理：将消息写入新会话
        storageAdapter.appendConversationMessage(branched.sessionId, msg);
      }
    }

    return { branchId: branched.sessionId, session: branched };
  }

  /** 列出会话的所有分支。 */
  listBranches(projectId: string): SessionRecord[] {
    return storageAdapter.listSessions(projectId);
  }
}

export const sessionBranchService = new SessionBranchService();
