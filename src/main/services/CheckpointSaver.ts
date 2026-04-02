/**
 * CheckpointSaver - LangGraph 检查点持久化
 * 基于文件系统的 BaseCheckpointSaver 实现
 * 将检查点存储到 workspace/checkpoints/{thread_id}/ 目录
 */

import { BaseCheckpointSaver } from '@langchain/langgraph-checkpoint';
import type { RunnableConfig } from '@langchain/core/runnables';
import * as fs from 'fs';
import * as path from 'path';

// 检查点相关类型（使用 any 作为 fallback 确保编译通过）
type Checkpoint = any;
type CheckpointMetadata = any;
type CheckpointTuple = any;
type PendingWrite = any;
type CheckpointListOptions = any;
type ChannelVersions = Record<string, number | string>;

/**
 * 基于文件系统的 LangGraph CheckpointSaver
 * 将检查点存储到 workspace/checkpoints/{thread_id}/ 目录
 */
export class FileCheckpointSaver extends BaseCheckpointSaver {
  private basePath: string;

  constructor(workspacePath: string) {
    super();
    this.basePath = path.join(workspacePath, 'checkpoints');
    this.ensureDir(this.basePath);
  }

  private ensureDir(dirPath: string): void {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
  }

  private getThreadDir(threadId: string): string {
    const dir = path.join(this.basePath, threadId);
    this.ensureDir(dir);
    return dir;
  }

  private getCheckpointPath(threadId: string, checkpointNs: string, checkpointId: string): string {
    const ns = checkpointNs || '__root__';
    const dir = path.join(this.getThreadDir(threadId), ns);
    this.ensureDir(dir);
    return path.join(dir, `${checkpointId}.json`);
  }

  private getWritesPath(threadId: string, checkpointNs: string, checkpointId: string, taskId: string): string {
    const ns = checkpointNs || '__root__';
    const dir = path.join(this.getThreadDir(threadId), ns, 'writes');
    this.ensureDir(dir);
    return path.join(dir, `${checkpointId}_${taskId}.json`);
  }

  private getIndexPath(threadId: string, checkpointNs: string): string {
    const ns = checkpointNs || '__root__';
    const dir = path.join(this.getThreadDir(threadId), ns);
    this.ensureDir(dir);
    return path.join(dir, 'index.json');
  }

  // 读取索引文件（维护检查点列表，按时间排序）
  private readIndex(threadId: string, checkpointNs: string): Array<{ checkpointId: string; timestamp: string; parentId?: string }> {
    const indexPath = this.getIndexPath(threadId, checkpointNs);
    if (fs.existsSync(indexPath)) {
      try {
        return JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
      } catch {
        return [];
      }
    }
    return [];
  }

  private writeIndex(threadId: string, checkpointNs: string, index: Array<{ checkpointId: string; timestamp: string; parentId?: string }>): void {
    const indexPath = this.getIndexPath(threadId, checkpointNs);
    fs.writeFileSync(indexPath, JSON.stringify(index, null, 2), 'utf-8');
  }

  async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
    const threadId = config.configurable?.thread_id as string;
    const checkpointNs = (config.configurable?.checkpoint_ns as string) || '';
    const checkpointId = config.configurable?.checkpoint_id as string | undefined;

    if (!threadId) return undefined;

    let targetId = checkpointId;

    // 如果没有指定 checkpoint_id，取最新的
    if (!targetId) {
      const index = this.readIndex(threadId, checkpointNs);
      if (index.length === 0) return undefined;
      targetId = index[index.length - 1].checkpointId;
    }

    const filePath = this.getCheckpointPath(threadId, checkpointNs, targetId);
    if (!fs.existsSync(filePath)) return undefined;

    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

      // 加载 pending writes
      const writesDir = path.join(this.getThreadDir(threadId), checkpointNs || '__root__', 'writes');
      const pendingWrites: PendingWrite[] = [];
      if (fs.existsSync(writesDir)) {
        const writeFiles = fs.readdirSync(writesDir).filter(f => f.startsWith(`${targetId}_`));
        for (const wf of writeFiles) {
          try {
            const writes = JSON.parse(fs.readFileSync(path.join(writesDir, wf), 'utf-8'));
            pendingWrites.push(...writes);
          } catch { /* skip corrupt */ }
        }
      }

      const resultConfig: RunnableConfig = {
        configurable: {
          thread_id: threadId,
          checkpoint_ns: checkpointNs,
          checkpoint_id: targetId,
        },
      };

      const parentConfig = data.parentId
        ? {
            configurable: {
              thread_id: threadId,
              checkpoint_ns: checkpointNs,
              checkpoint_id: data.parentId,
            },
          }
        : undefined;

      return {
        config: resultConfig,
        checkpoint: data.checkpoint,
        metadata: data.metadata,
        parentConfig,
        pendingWrites,
      };
    } catch {
      return undefined;
    }
  }

  async put(
    config: RunnableConfig,
    checkpoint: Checkpoint,
    metadata: CheckpointMetadata,
    newVersions: ChannelVersions
  ): Promise<RunnableConfig> {
    const threadId = config.configurable?.thread_id as string;
    const checkpointNs = (config.configurable?.checkpoint_ns as string) || '';
    const checkpointId = checkpoint.id as string;
    const parentId = config.configurable?.checkpoint_id as string | undefined;

    const filePath = this.getCheckpointPath(threadId, checkpointNs, checkpointId);

    const data = {
      checkpoint,
      metadata,
      parentId,
      newVersions,
      savedAt: new Date().toISOString(),
    };

    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');

    // 更新索引
    const index = this.readIndex(threadId, checkpointNs);
    index.push({
      checkpointId,
      timestamp: new Date().toISOString(),
      parentId,
    });
    this.writeIndex(threadId, checkpointNs, index);

    return {
      configurable: {
        thread_id: threadId,
        checkpoint_ns: checkpointNs,
        checkpoint_id: checkpointId,
      },
    };
  }

  async putWrites(config: RunnableConfig, writes: PendingWrite[], taskId: string): Promise<void> {
    const threadId = config.configurable?.thread_id as string;
    const checkpointNs = (config.configurable?.checkpoint_ns as string) || '';
    const checkpointId = config.configurable?.checkpoint_id as string;

    if (!threadId || !checkpointId) return;

    const filePath = this.getWritesPath(threadId, checkpointNs, checkpointId, taskId);
    fs.writeFileSync(filePath, JSON.stringify(writes, null, 2), 'utf-8');
  }

  async *list(config: RunnableConfig, options?: CheckpointListOptions): AsyncGenerator<CheckpointTuple> {
    const threadId = config.configurable?.thread_id as string;
    const checkpointNs = (config.configurable?.checkpoint_ns as string) || '';

    if (!threadId) return;

    const index = this.readIndex(threadId, checkpointNs);
    const limit = options?.limit;
    const before = options?.before;

    // 按时间倒序
    let entries = [...index].reverse();

    if (before?.configurable?.checkpoint_id) {
      const beforeIdx = entries.findIndex(
        e => e.checkpointId === before.configurable.checkpoint_id
      );
      if (beforeIdx >= 0) {
        entries = entries.slice(beforeIdx + 1);
      }
    }

    if (limit) {
      entries = entries.slice(0, limit);
    }

    for (const entry of entries) {
      const tuple = await this.getTuple({
        configurable: {
          thread_id: threadId,
          checkpoint_ns: checkpointNs,
          checkpoint_id: entry.checkpointId,
        },
      });
      if (tuple) {
        yield tuple;
      }
    }
  }

  /**
   * 删除指定 thread 的所有检查点和写入数据
   * @param threadId 要删除的线程 ID
   */
  async deleteThread(threadId: string): Promise<void> {
    const threadDir = path.join(this.basePath, threadId);
    if (fs.existsSync(threadDir)) {
      fs.rmSync(threadDir, { recursive: true, force: true });
    }
  }
}
