/**
 * UltraPlan — Opus 级深度规划模式。
 *
 * 为复杂任务提供 30 分钟执行窗口的结构化规划。
 * 输出: 执行计划 → 子任务列表 → 验证策略 → 可追溯交付。
 */
export interface UltraPlanResult {
  planId: string;
  title: string;
  phases: Array<{ title: string; tasks: string[]; verification: string }>;
  estimatedComplexity: 'low' | 'medium' | 'high' | 'extreme';
  createdAt: number;
}

export class UltraPlan {
  /**
   * 生成 UltraPlan。
   * @param taskDescription 用户任务描述
   * @param providerCall LLM provider 调用函数
   */
  async generatePlan(taskDescription: string, providerCall: (prompt: string) => Promise<string>): Promise<UltraPlanResult> {
    const prompt = [
      'You are a principal software architect. Design a comprehensive implementation plan for the following task:',
      '',
      `**Task**: ${taskDescription}`,
      '',
      'Your plan must include:',
      '1. A clear title',
      '2. Phase breakdown (2-5 phases)',
      '3. Each phase: specific tasks + verification strategy',
      '4. Overall complexity assessment',
      '',
      'Output as JSON: { "title": "...", "phases": [{ "title": "...", "tasks": ["..."], "verification": "..." }], "estimatedComplexity": "low|medium|high|extreme" }',
    ].join('\n');

    const response = await providerCall(prompt);
    try {
      const json = JSON.parse(response) as Partial<UltraPlanResult>;
      return {
        planId: `ultraplan_${Date.now()}`,
        title: json.title ?? 'UltraPlan',
        phases: json.phases ?? [],
        estimatedComplexity: json.estimatedComplexity ?? 'medium',
        createdAt: Date.now(),
      };
    } catch {
      return {
        planId: `ultraplan_${Date.now()}`,
        title: 'UltraPlan',
        phases: [{ title: 'Phase 1', tasks: [taskDescription], verification: 'Manual check' }],
        estimatedComplexity: 'medium',
        createdAt: Date.now(),
      };
    }
  }
}
