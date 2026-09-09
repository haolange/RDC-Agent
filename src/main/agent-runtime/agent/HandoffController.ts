/**
 * HandoffController — orchestrator 层 profile 移交预检。
 *
 * 只解析 frozen 白名单、算出 send / declaredModel / depth，并预检
 * 单活跃 / 链上限 / model。不写盘。落盘由 HandoffStateStore 在工具成功后完成。
 */

import { HANDOFF_CHAIN_LIMIT, HANDOFF_ERROR } from '@shared/types/profileHandoff';
import type { FrozenHandoffDefinition } from '../EffectiveRuntimePlan';

export interface HandoffRequest {
  fromAgentId: string;
  toProfile: string;
  prompt: string;
  label: string;
  send: boolean;
  declaredModel: string | null;
  chainRoot: string;
  depth: number;
}

export interface FrozenHandoffContext {
  sourceHandoffs: readonly FrozenHandoffDefinition[];
  enabledProfileIds: readonly string[];
  /** When omitted, depth/active/model preflight is skipped (frozen-authority unit tests). */
  sessionId?: string;
  hasActiveHandoff?: boolean;
  nextDepth?: number;
  chainRoot?: string;
  isDeclaredModelValid?: (canonical: string) => boolean;
}

export interface HandoffResolveResult {
  valid: boolean;
  request?: HandoffRequest;
  reason?: string;
  code?: string;
}

function fail(code: string, reason: string): HandoffResolveResult {
  return { valid: false, code, reason };
}

export class HandoffController {
  resolve(
    fromAgentId: string,
    toProfile: string,
    promptOverride?: string,
    labelOverride?: string,
    frozen?: FrozenHandoffContext,
  ): HandoffResolveResult {
    const target = toProfile.trim();
    if (!target) {
      return fail(HANDOFF_ERROR.NOT_DECLARED, 'Handoff target profile is empty.');
    }

    if (!frozen) {
      return fail(HANDOFF_ERROR.REQUIRES_FROZEN_PLAN, 'Handoff requires a frozen turn runtime plan.');
    }
    const targetEnabled = frozen.enabledProfileIds.includes(target);
    if (!targetEnabled) {
      return fail(
        HANDOFF_ERROR.TARGET_DISABLED,
        'Target profile "' + target + '" is not enabled or does not exist.',
      );
    }
    const sourceHandoffs = frozen.sourceHandoffs ?? [];
    if (sourceHandoffs.length === 0 || !sourceHandoffs.some((handoff) => handoff.agent === target)) {
      return fail(
        HANDOFF_ERROR.NOT_DECLARED,
        sourceHandoffs.length === 0
          ? `Profile "${fromAgentId}" declares no handoffs.`
          : `Profile "${fromAgentId}" does not declare a handoff to "${target}".`,
      );
    }

    const declared = sourceHandoffs.find((handoff) => handoff.agent === target);
    const prompt = promptOverride?.trim() ?? '';
    if (!prompt) return fail(HANDOFF_ERROR.STATE_CONFLICT, 'A non-empty handoff summary is required.');
    const label = (labelOverride?.trim() || declared?.label || `Hand off to ${target}`).trim();
    const send = declared?.send === true;
    const declaredModel = typeof declared?.model === 'string' && declared.model.trim()
      ? declared.model.trim()
      : null;

    if (frozen.hasActiveHandoff) {
      return fail(HANDOFF_ERROR.ALREADY_ACTIVE, 'Session already has an unfinished handoff.');
    }

    const depth = frozen.nextDepth ?? 1;
    const chainRoot = frozen.chainRoot?.trim() || `handoff-root-${fromAgentId}`;
    if (depth > HANDOFF_CHAIN_LIMIT) {
      return fail(
        HANDOFF_ERROR.CHAIN_LIMIT,
        `Handoff chain exceeds the limit of ${HANDOFF_CHAIN_LIMIT}.`,
      );
    }

    if (declaredModel && frozen.isDeclaredModelValid && !frozen.isDeclaredModelValid(declaredModel)) {
      return fail(HANDOFF_ERROR.MODEL_INVALID, `Handoff declaredModel "${declaredModel}" is not executable.`);
    }

    return {
      valid: true,
      request: {
        fromAgentId,
        toProfile: target,
        prompt,
        label,
        send,
        declaredModel,
        chainRoot,
        depth,
      },
    };
  }
}

/** 共享单例。 */
export const handoffController = new HandoffController();
