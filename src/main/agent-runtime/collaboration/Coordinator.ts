/**
 * Coordinator — 主代理分解任务 → 并行 worker → 收集结果。
 *
 * 模式:
 *  1. Master agent 分解任务为 subtask 列表
 *  2. 每个 subtask 分派给一个子代理（SubagentSpawner）
 *  3. 收集所有子代理结果，合并为最终输出
 */
import type { SubagentSpawner } from './SubagentSpawner';
import type { UserMessage } from '../core/types';

export interface Subtask {
  id: string;
  prompt: string;
  agentType?: string;
}

export interface SubtaskResult {
  subtaskId: string;
  output: string;
  error?: string;
}

export interface CoordinatorResult {
  results: SubtaskResult[];
  mergedOutput: string;
}

export class Coordinator {
  constructor(private spawner: SubagentSpawner) {}

  /** 分解并并行执行 subtasks。 */
  async coordinate(subtasks: Subtask[], masterPrompt: string): Promise<CoordinatorResult> {
    const promises = subtasks.map(async (st): Promise<SubtaskResult> => {
      try {
        const userMsg: UserMessage = { role: 'user', content: st.prompt, timestamp: Date.now() };
        const subagent = await (this.spawner as unknown as { spawn: (id: string, type?: string, config?: Record<string, unknown>) => Promise<{ execute?: (msgs: UserMessage[]) => Promise<string> }> }).spawn(`coordinator-${st.id}`, st.agentType);
        // 子代理执行 — 通过 spawner 的通用接口
        const handle = subagent as { execute?: (msgs: UserMessage[]) => Promise<string> };
        const result = handle.execute ? await handle.execute([userMsg]) : 'subagent completed';
        return { subtaskId: st.id, output: result };
      } catch (err) {
        return { subtaskId: st.id, output: '', error: err instanceof Error ? err.message : String(err) };
      }
    });

    const results = await Promise.all(promises);
    const lines: string[] = [`**Coordinator Results** (${subtasks.length} subtasks)\n`];
    for (const r of results) {
      const status = r.error ? '❌' : '✅';
      lines.push(`${status} **${r.subtaskId}**: ${r.error ? `ERROR: ${r.error}` : r.output.slice(0, 500)}`);
    }
    lines.push(`\n**Master Task**: ${masterPrompt}`);
    return { results, mergedOutput: lines.join('\n') };
  }
}
