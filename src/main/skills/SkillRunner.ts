/**
 * Skill 执行器
 * 执行 skill 并转换为 LangGraph 兼容的 StructuredTool
 */
import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { skillRegistry } from './SkillRegistry';
import type { SkillExecutionContext, SkillExecutionResult, SkillParameter } from '../../shared/types/skill';

export class SkillRunner {
  /**
   * 执行指定 skill
   */
  async execute(
    skillName: string,
    args: Record<string, unknown>,
    context: SkillExecutionContext
  ): Promise<SkillExecutionResult> {
    const skill = skillRegistry.get(skillName);
    if (!skill) {
      return {
        success: false,
        output: '',
        error: `Skill not found: ${skillName}`,
        duration_ms: 0,
      };
    }

    const startTime = Date.now();
    try {
      const result = await skill.execute(args, context);
      return {
        ...result,
        duration_ms: Date.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        output: '',
        error: error instanceof Error ? error.message : String(error),
        duration_ms: Date.now() - startTime,
      };
    }
  }

  /**
   * 将所有已注册的 skill 转换为 LangGraph DynamicStructuredTool 数组
   */
  toTools(): DynamicStructuredTool[] {
    const skills = skillRegistry.list();
    return skills.map(def => this.skillToTool(def));
  }

  /**
   * 将单个 skill 转换为 DynamicStructuredTool
   */
  private skillToTool(def: import('../../shared/types/skill').SkillDefinition): DynamicStructuredTool {
    const schema = this.buildSchema(def.parameters);

    return new DynamicStructuredTool({
      name: `skill_${def.name}`,
      description: def.description,
      schema,
      func: async (args: Record<string, unknown>) => {
        // context 在实际调用时需要从外部传入
        // 这里提供一个占位 context，实际使用时通过 config 传递
        const context: SkillExecutionContext = {
          caseId: '',
          runId: '',
          sessionId: '',
          agentId: '',
          workspacePath: '',
        };
        const result = await this.execute(def.name, args, context);
        return JSON.stringify(result);
      },
      metadata: {
        layer: 'skill',
        skillName: def.name,
        source: def.source,
        version: def.version,
      },
    });
  }

  /**
   * 从 SkillParameter[] 构建 Zod schema
   */
  private buildSchema(parameters: SkillParameter[]): z.ZodObject<any> {
    const shape: Record<string, z.ZodTypeAny> = {};

    for (const param of parameters) {
      let zodType: z.ZodTypeAny;

      switch (param.type) {
        case 'string':
          zodType = z.string().describe(param.description);
          break;
        case 'number':
          zodType = z.number().describe(param.description);
          break;
        case 'boolean':
          zodType = z.boolean().describe(param.description);
          break;
        case 'object':
          zodType = z.record(z.string(), z.unknown()).describe(param.description);
          break;
        case 'array':
          zodType = z.array(z.unknown()).describe(param.description);
          break;
        default:
          zodType = z.unknown().describe(param.description);
      }

      if (!param.required) {
        zodType = zodType.optional();
        if (param.default !== undefined) {
          zodType = zodType.default(param.default);
        }
      }

      shape[param.name] = zodType;
    }

    return z.object(shape);
  }
}

/** 单例 */
export const skillRunner = new SkillRunner();
