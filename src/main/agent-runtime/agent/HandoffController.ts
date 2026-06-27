/**
 * HandoffController — orchestrator 层 profile 移交控制。
 *
 * 职责：
 *  - 解析目标 profile 的 `.agent.md` handoffs frontmatter；
 *  - 校验 handoff 合法性（目标 profile 存在且在源 profile 声明的 handoffs 列表内）；
 *  - 生成 handoff 描述（label/prompt），缺省 prompt 从目标 profile handoffs 定义取。
 *
 * Handoff 是 session 级控制权转移（DESIGN.md：渲染为 next-action，非 tool card），
 * 不是工具返回值。本控制器只产出 handoff 描述，实际 profile 切换由 ConversationService
 * 消费 handoff 请求后执行。
 *
 * 设计参考 claude-code coordinator 的 task-notification 协议，但本库为单进程串行，
 * handoff 不走 mailbox，直接通过 tool_result details 上抛到 ConversationService。
 */

import type { AgentHandoffDefinition } from '@shared/types/agentManifest';
import { settingsService } from '../../settings/SettingsService';

export interface HandoffRequest {
  /** 源 profile。 */
  fromAgentId: string;
  /** 目标 profile id。 */
  toProfile: string;
  /** 移交后注入的 prompt。 */
  prompt: string;
  /** handoff 标签。 */
  label: string;
}

export interface HandoffResolveResult {
  /** 是否合法。 */
  valid: boolean;
  /** 解析后的 handoff 请求（合法时）。 */
  request?: HandoffRequest;
  /** 不合法时的原因。 */
  reason?: string;
}

export class HandoffController {
  /**
   * 解析并校验 handoff 请求。
   *
   * @param fromAgentId 源 profile（当前活跃 agent）
   * @param toProfile 目标 profile id（agent_handoff 工具的 agent 参数）
   * @param promptOverride 调用方提供的 prompt（缺省时从目标 profile handoffs 定义取）
   * @param labelOverride 调用方提供的 label
   */
  resolve(
    fromAgentId: string,
    toProfile: string,
    promptOverride?: string,
    labelOverride?: string,
  ): HandoffResolveResult {
    const target = toProfile.trim();
    if (!target) {
      return { valid: false, reason: 'Handoff target profile is empty.' };
    }

    // 校验目标 profile 存在且启用
    const definitions = settingsService.getAll().agents.definitions;
    const targetDef = definitions.find((d) => d.id === target && d.enabled);
    if (!targetDef) {
      return { valid: false, reason: `Target profile "${target}" is not enabled or does not exist.` };
    }

    // 校验目标在源 profile 声明的 handoffs 列表内（若源 profile 有声明 handoffs）
    const sourceDef = definitions.find((d) => d.id === fromAgentId && d.enabled);
    if (sourceDef && sourceDef.handoffs.length > 0) {
      const allowed = sourceDef.handoffs.some((h) => h.agent === target);
      if (!allowed) {
        return {
          valid: false,
          reason: `Profile "${fromAgentId}" does not declare a handoff to "${target}".`,
        };
      }
    }

    // 缺省 prompt/label 从源 profile 声明的 handoffs 定义取
    const declared: AgentHandoffDefinition | undefined = sourceDef?.handoffs.find((h) => h.agent === target);
    const prompt = (promptOverride?.trim() || declared?.prompt || `Continue from ${fromAgentId} as ${target}.`).trim();
    const label = (labelOverride?.trim() || declared?.label || `Hand off to ${target}`).trim();

    return {
      valid: true,
      request: { fromAgentId, toProfile: target, prompt, label },
    };
  }
}

/** 共享单例。 */
export const handoffController = new HandoffController();
