/**
 * Mode Capabilities Constants - 模式能力常量定义
 */

import type { ModeCapabilities } from '../types/workflow';
import type { CaptureRole } from '../types/session';

export const MODE_CAPABILITIES: Record<string, ModeCapabilities> = {
  debugger: {
    mode: 'debugger',
    availableStages: [
      'preflight_pending', 'intent_gate_passed', 'entry_gate_passed',
      'accepted_intake_initialized', 'intake_gate_passed',
      'waiting_for_specialist_brief', 'specialist_briefs_collected',
      'expert_investigation_complete', 'fix_verification_complete',
      'skeptic_ready', 'curator_ready', 'finalized'
    ],
    requiresLLM: true,
    isFullyImplemented: true,
  },
  analyzer: {
    mode: 'analyzer',
    availableStages: ['preflight_pending', 'accepted_intake_initialized'],
    requiresLLM: true,
    isFullyImplemented: false,
    disabledReason: 'Analyzer mode is not yet fully implemented',
  },
  optimizer: {
    mode: 'optimizer',
    availableStages: ['preflight_pending', 'accepted_intake_initialized'],
    requiresLLM: true,
    isFullyImplemented: false,
    disabledReason: 'Optimizer mode is not yet fully implemented',
  },
};

/**
 * 默认 capture 角色分配规则：首个 primary，第二个 baseline，其余 reference
 */
export function assignDefaultCaptureRoles(count: number): CaptureRole[] {
  const roles: CaptureRole[] = [];
  for (let i = 0; i < count; i++) {
    if (i === 0) roles.push('primary');
    else if (i === 1) roles.push('baseline');
    else roles.push('reference');
  }
  return roles;
}
