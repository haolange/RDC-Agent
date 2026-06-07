/**
 * ToolPermission — 三层工具权限系统。
 *
 * 评估顺序：
 *   Layer 0: allowlist（如果启用）—— 不在白名单的工具直接拒绝。
 *   Layer 1: HardDeny —— 任意一条命中则直接拒绝（不可被后续覆盖）。
 *   Layer 2: PolicyRules —— Agent Profile 等策略，可 allow / deny / ask_user。
 *   Layer 3: ApprovalRequired —— 标记需要用户交互确认的工具。
 *   Default: allow。
 *
 * 全部规则 evaluate() 同步返回，不允许 I/O。
 */

import * as path from 'path';
import type { ToolCall } from '../core/types';
import type { AgentTool } from './AgentTool';

// =====================================================================
// 类型
// =====================================================================

export type PermissionDecision = 'allow' | 'deny' | 'ask_user';

export interface PermissionResult {
  decision: PermissionDecision;
  reason: string;
}

export interface PermissionContext {
  toolName: string;
  toolCall: ToolCall;
  tool?: AgentTool;
  agentId?: string;
}

/** 权限规则接口。 */
export interface PermissionRule {
  name: string;
  evaluate(context: PermissionContext): PermissionResult;
}

// =====================================================================
// ToolPermission 主类
// =====================================================================

export class ToolPermission {
  private hardDenyRules: PermissionRule[] = [];
  private policyRules: PermissionRule[] = [];
  private approvalRequiredTools = new Set<string>();
  private allowlist: Set<string> | null = null;

  /** 添加硬拒绝规则。 */
  addHardDenyRule(rule: PermissionRule): void {
    this.hardDenyRules.push(rule);
  }

  /** 添加策略规则。 */
  addPolicyRule(rule: PermissionRule): void {
    this.policyRules.push(rule);
  }

  /** 标记工具需要用户审批。 */
  markRequiresApproval(toolName: string): void {
    this.approvalRequiredTools.add(toolName);
  }

  /** 取消工具的审批要求。 */
  unmarkRequiresApproval(toolName: string): void {
    this.approvalRequiredTools.delete(toolName);
  }

  /** 设置工具允许列表。 */
  setAllowlist(tools: string[]): void {
    this.allowlist = new Set(tools);
  }

  /** 清除允许列表（恢复为不限制）。 */
  clearAllowlist(): void {
    this.allowlist = null;
  }

  /** 评估权限。 */
  evaluate(context: PermissionContext): PermissionResult {
    // Layer 0: allowlist
    if (this.allowlist && !this.allowlist.has(context.toolName)) {
      return {
        decision: 'deny',
        reason: `工具 "${context.toolName}" 不在允许列表内`,
      };
    }

    // Layer 1: HardDeny
    for (const rule of this.hardDenyRules) {
      const result = rule.evaluate(context);
      if (result.decision === 'deny') {
        return {
          decision: 'deny',
          reason: `[${rule.name}] ${result.reason}`,
        };
      }
    }

    // Layer 2: Policy
    for (const rule of this.policyRules) {
      const result = rule.evaluate(context);
      if (result.decision === 'deny') {
        return {
          decision: 'deny',
          reason: `[${rule.name}] ${result.reason}`,
        };
      }
      if (result.decision === 'ask_user') {
        return {
          decision: 'ask_user',
          reason: `[${rule.name}] ${result.reason}`,
        };
      }
    }

    // Layer 3: Approval required
    if (this.approvalRequiredTools.has(context.toolName)) {
      return {
        decision: 'ask_user',
        reason: `工具 "${context.toolName}" 需要用户确认`,
      };
    }

    return { decision: 'allow', reason: 'allowed' };
  }
}

// =====================================================================
// 内置规则
// =====================================================================

/** Bash 危险命令硬拒绝规则。 */
export class BashDenyListRule implements PermissionRule {
  readonly name = 'bash-deny-list';

  private readonly denyPatterns: string[] = [
    'rm -rf /',
    'rm -rf /*',
    'sudo ',
    'shutdown',
    'reboot',
    'mkfs',
    'dd if=',
    '> /dev/',
    'chmod 777',
    'format c:',
    'format /q',
    ':(){ :|:& };:',
  ];

  evaluate(context: PermissionContext): PermissionResult {
    if (context.toolName !== 'bash') {
      return { decision: 'allow', reason: 'not bash' };
    }
    const command = String(context.toolCall.arguments?.command ?? '');
    const lowered = command.toLowerCase();
    for (const pattern of this.denyPatterns) {
      if (lowered.includes(pattern.toLowerCase())) {
        return {
          decision: 'deny',
          reason: `命令包含危险模式 "${pattern}"`,
        };
      }
    }
    return { decision: 'allow', reason: 'safe' };
  }
}

/**
 * 文件写入路径安全规则。
 *
 * 适用于带有 `path` 参数的文件类工具（write_file / edit_file / read_file 等）。
 * 解析为绝对路径后判断是否仍位于 `workspaceRoot` 内部。
 */
export class PathEscapeRule implements PermissionRule {
  readonly name = 'path-escape';

  constructor(private readonly workspaceRoot: string) {}

  evaluate(context: PermissionContext): PermissionResult {
    const args = context.toolCall.arguments ?? {};
    const rawPath = args.path;
    if (typeof rawPath !== 'string' || rawPath.length === 0) {
      return { decision: 'allow', reason: 'no path' };
    }

    const root = path.resolve(this.workspaceRoot);
    const target = path.isAbsolute(rawPath)
      ? path.resolve(rawPath)
      : path.resolve(root, rawPath);

    const rel = path.relative(root, target);
    const escaped =
      rel.startsWith('..') || path.isAbsolute(rel) || rel === '..';
    if (escaped) {
      return {
        decision: 'deny',
        reason: `路径 "${rawPath}" 超出 workspace (${root})`,
      };
    }
    return { decision: 'allow', reason: 'inside workspace' };
  }
}

/** 基于 permissionHint 的审批规则：mutation/destructive 默认要求审批。 */
export class MutationApprovalRule implements PermissionRule {
  readonly name = 'mutation-approval';

  evaluate(context: PermissionContext): PermissionResult {
    const hint = context.tool?.permissionHint;
    if (hint === 'destructive') {
      return {
        decision: 'ask_user',
        reason: `工具 "${context.toolName}" 为破坏性操作，需要确认`,
      };
    }
    if (hint === 'mutation') {
      return {
        decision: 'ask_user',
        reason: `工具 "${context.toolName}" 会修改环境，需要确认`,
      };
    }
    return { decision: 'allow', reason: 'readonly or unspecified' };
  }
}
