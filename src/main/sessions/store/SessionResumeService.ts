/**
 * SessionResumeService — 会话恢复服务。
 *
 * 负责应用启动时：
 *  - 检测上次活跃的会话；
 *  - 恢复会话的对话历史、运行上下文和 Agent 状态；
 *  - 返回是否可恢复的判定。
 */

import { storageAdapter } from './StorageAdapter';

export interface SessionResumeState {
  sessionId: string;
  projectId: string;
  runId: string | null;
  /** 是否有未完成的 agent run。 */
  runResumable: boolean;
  /** 上次会话中 agent 的最后一条消息片段（用于 UI 预览）。 */
  lastMessagePreview?: string;
}

export class SessionResumeService {
  /** 获取可恢复的会话状态。若无历史会话，返回 null。 */
  async getResumableSession(): Promise<SessionResumeState | null> {
    try {
      const sessionId = await storageAdapter.getCurrentSessionId();
      if (!sessionId) return null;

      const session = storageAdapter.readSession(sessionId);
      if (!session) return null;

      const projectId = session.projectId;
      const latestRun = storageAdapter.getLatestRun(sessionId);

      // 检查是否有未完成的 run（状态非 success/failed/stopped 等终态）
      const runningStatuses = ['running', 'awaiting_input', 'awaiting_approval'] as string[];
      const unfinishedRuns = storageAdapter.listRuns(sessionId).filter(
        (r) => runningStatuses.includes(r.status),
      );
      const runResumable = unfinishedRuns.length > 0;

      return {
        sessionId,
        projectId,
        runId: latestRun?.runId ?? null,
        runResumable,
        lastMessagePreview: session.title ?? undefined,
      };
    } catch {
      return null;
    }
  }

  /** 获取会话的对话历史（用于恢复时加载到 UI）。 */
  async getSessionHistory(sessionId: string) {
    try {
      return storageAdapter.readConversationHistory(sessionId);
    } catch {
      return null;
    }
  }
}

export const sessionResumeService = new SessionResumeService();
