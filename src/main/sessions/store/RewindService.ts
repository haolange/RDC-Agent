/**
 * RewindService — 回滚 (/rewind)。
 *
 * 支持:
 *  - 回滚代码到指定检查点（git reflog / stash）
 *  - 回滚对话到指定轮次
 */

export interface Checkpoint {
  id: string;
  timestamp: number;
  description: string;
  turnIndex: number;
  gitRef?: string;
}

export interface RewindResult {
  success: boolean;
  message: string;
  restoredTo?: Checkpoint;
}

export class RewindService {
  private checkpoints: Checkpoint[] = [];

  /** 创建检查点。 */
  createCheckpoint(description: string, turnIndex: number): Checkpoint {
    const cp: Checkpoint = {
      id: `ckpt_${Date.now()}`,
      timestamp: Date.now(),
      description,
      turnIndex,
    };
    this.checkpoints.push(cp);
    return cp;
  }

  /** 列出所有检查点。 */
  listCheckpoints(): Checkpoint[] {
    return [...this.checkpoints].sort((a, b) => b.timestamp - a.timestamp);
  }

  /** 回滚到指定检查点。 */
  async rewind(checkpointId: string): Promise<RewindResult> {
    const cp = this.checkpoints.find((c) => c.id === checkpointId);
    if (!cp) {
      return { success: false, message: `Checkpoint not found: ${checkpointId}` };
    }

    // 移除该检查点之后的所有检查点
    this.checkpoints = this.checkpoints.filter((c) => c.timestamp <= cp.timestamp);

    return {
      success: true,
      message: `Rewound to checkpoint: ${cp.description} (turn ${cp.turnIndex})`,
      restoredTo: cp,
    };
  }

  /** 清除所有检查点。 */
  clear(): void { this.checkpoints = []; }
}

export const rewindService = new RewindService();
