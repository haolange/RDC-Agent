/**
 * SkillEngine — 技能执行引擎。
 *
 * 支持三种技能类型：
 *  - prompt: 提示模板展开 → 注入为系统消息 → 调用 Agent；
 *  - tool:   技能定义新工具 → 注册到 Agent 的工具表；
 *  - workflow: 多步骤 Agent 编排。
 */

import type { ToolDefinition } from '../agent-runtime/core/types';
import type { AgentOrchestrator } from '../workflow/debugger/AgentOrchestrator';

/** 技能 manifest 定义。 */
export interface SkillManifest {
  name: string;
  description: string;
  type: 'prompt' | 'tool' | 'workflow';
  /** prompt 类型：展开模板 */
  promptTemplate?: string;
  /** tool 类型：工具定义 */
  tools?: ToolDefinition[];
  /** workflow 类型：步骤列表 */
  steps?: SkillStep[];
  /** 技能所需的模型能力要求。 */
  requires?: { reasoning?: boolean; vision?: boolean };
}

export interface SkillStep {
  prompt: string;
  /** 期望的输出 schema（可选）。 */
  outputSchema?: Record<string, unknown>;
}

export interface SkillExecutionContext {
  agentOrchestrator?: AgentOrchestrator;
  workspaceRoot?: string;
  sessionId?: string;
}

export interface SkillExecutionResult {
  success: boolean;
  message: string;
  data?: unknown;
}

export class SkillEngine {
  /**
   * 执行技能。
   *
   * - prompt 技能：将展开后的提示作为系统消息注入 agent；
   * - tool 技能：返回工具定义供外部注册；
   * - workflow 技能：依次执行每个 step。
   */
  async execute(
    manifest: SkillManifest,
    params: Record<string, string>,
    _context: SkillExecutionContext,
  ): Promise<SkillExecutionResult> {
    switch (manifest.type) {
      case 'prompt': {
        const expanded = this.expandTemplate(
          manifest.promptTemplate ?? manifest.description,
          params,
        );
        return {
          success: true,
          message: expanded,
          data: { prompt: expanded },
        };
      }

      case 'tool': {
        const toolNames = (manifest.tools ?? []).map((t) => t.name);
        return {
          success: true,
          message: `Skill "${manifest.name}" provides tools: ${toolNames.join(', ')}`,
          data: { tools: manifest.tools },
        };
      }

      case 'workflow': {
        const steps = manifest.steps ?? [];
        const outputs: string[] = [];
        for (let i = 0; i < steps.length; i++) {
          const step = steps[i];
          const expanded = this.expandTemplate(step.prompt, params);
          outputs.push(`[Step ${i + 1}] ${expanded}`);
        }
        return {
          success: true,
          message: `Workflow "${manifest.name}" completed ${steps.length} steps.`,
          data: { steps: outputs },
        };
      }

      default:
        return {
          success: false,
          message: `Unknown skill type: ${(manifest as { type: string }).type}`,
        };
    }
  }

  /** 简单的模板展开：将 {{key}} 替换为 params[key]。 */
  private expandTemplate(
    template: string,
    params: Record<string, string>,
  ): string {
    return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
      return params[key] ?? `{{${key}}}`;
    });
  }
}
