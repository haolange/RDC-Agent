/**
 * PersistedPermissionManager — 持久化权限规则管理。
 *
 * 负责：
 *  - 从 AppSettings 加载持久化权限规则；
 *  - 为 ToolPermission 构造 PermissionRule 实例；
 *  - 写入/删除用户决定的规则（"Always allow" / "Always deny"）。
 */

import type { PersistedPermissionRule } from '@shared/types/settings';
import type { PermissionContext, PermissionResult } from '../agent/ToolPermission';

/** 将持久化规则转为 ToolPermission 可用的 PermissionRule。 */
function toPermissionRule(entry: PersistedPermissionRule) {
  return {
    name: `persisted:${entry.toolName}:${entry.decision}`,
    evaluate: (ctx: PermissionContext): PermissionResult => {
      if (ctx.toolName === entry.toolName) {
        return {
          decision: entry.decision,
          reason: `Persisted rule: ${entry.decision} ${entry.toolName}`,
        };
      }
      return { decision: 'allow', reason: 'not matched' };
    },
  };
}

export class PersistedPermissionManager {
  private rules: PersistedPermissionRule[] = [];

  /** 从 settings 加载持久化规则。 */
  load(rules: PersistedPermissionRule[] | undefined): void {
    this.rules = rules ? [...rules] : [];
  }

  /** 获取所有持久化规则的 PermissionRule 列表。 */
  getPermissionRules() {
    return this.rules.map(toPermissionRule);
  }

  /** 添加一条持久化规则。 */
  addRule(toolName: string, decision: 'allow' | 'deny'): PersistedPermissionRule {
    // 删除旧条目（如有）
    this.rules = this.rules.filter((r) => r.toolName !== toolName);

    const rule: PersistedPermissionRule = {
      toolName,
      decision,
      scope: 'project',
      createdAt: Date.now(),
    };
    this.rules.push(rule);
    return rule;
  }

  /** 删除某工具的持久化规则。 */
  removeRule(toolName: string): void {
    this.rules = this.rules.filter((r) => r.toolName !== toolName);
  }

  /** 获取当前持久化规则数组（用于保存到 settings）。 */
  getRules(): PersistedPermissionRule[] {
    return [...this.rules];
  }
}
