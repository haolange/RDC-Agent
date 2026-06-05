/**
 * Skill 系统类型定义
 */

/** Skill 参数定义 */
export interface SkillParameter {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  description: string;
  required: boolean;
  default?: unknown;
}

/** Skill 定义 */
export interface SkillDefinition {
  name: string;
  displayName: string;
  description: string;
  version: string;
  parameters: SkillParameter[];
  /** 来源：内置 / 插件 */
  source: 'builtin' | 'plugin' | 'workspace';
  /** Skill 文件路径（plugin 类型时） */
  filePath?: string;
  /** 标签 */
  tags: string[];
}

/** Skill 执行上下文 */
export interface SkillExecutionContext {
  caseId: string;
  runId: string;
  sessionId: string;
  agentId: string;
  workspacePath: string;
}

/** Skill 执行结果 */
export interface SkillExecutionResult {
  success: boolean;
  output: string;
  artifacts?: Array<{
    type: string;
    path: string;
    description: string;
  }>;
  error?: string;
  duration_ms: number;
}
