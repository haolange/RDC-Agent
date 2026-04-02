/**
 * Skill 注册表
 * 管理内置和插件 skill 的注册、查询和生命周期
 */
import type { SkillDefinition } from '../../shared/types/skill';

/** Skill 执行函数类型 */
export type SkillExecuteFn = (
  args: Record<string, unknown>,
  context: import('../../shared/types/skill').SkillExecutionContext
) => Promise<import('../../shared/types/skill').SkillExecutionResult>;

/** 注册的 Skill（包含执行函数） */
export interface RegisteredSkill {
  definition: SkillDefinition;
  execute: SkillExecuteFn;
}

export class SkillRegistry {
  private skills: Map<string, RegisteredSkill> = new Map();

  /** 注册 skill */
  register(definition: SkillDefinition, execute: SkillExecuteFn): void {
    if (this.skills.has(definition.name)) {
      console.warn(`[SkillRegistry] Overwriting existing skill: ${definition.name}`);
    }
    this.skills.set(definition.name, { definition, execute });
  }

  /** 注销 skill */
  unregister(name: string): boolean {
    return this.skills.delete(name);
  }

  /** 获取 skill */
  get(name: string): RegisteredSkill | undefined {
    return this.skills.get(name);
  }

  /** 列出所有 skill 定义 */
  list(): SkillDefinition[] {
    return Array.from(this.skills.values()).map(s => s.definition);
  }

  /** 按标签过滤 */
  listByTag(tag: string): SkillDefinition[] {
    return this.list().filter(s => s.tags.includes(tag));
  }

  /** 按来源过滤 */
  listBySource(source: 'builtin' | 'plugin'): SkillDefinition[] {
    return this.list().filter(s => s.source === source);
  }

  /** 检查 skill 是否存在 */
  has(name: string): boolean {
    return this.skills.has(name);
  }

  /** 获取注册数量 */
  get size(): number {
    return this.skills.size;
  }

  /** 清空所有注册 */
  clear(): void {
    this.skills.clear();
  }
}

/** 单例 */
export const skillRegistry = new SkillRegistry();
