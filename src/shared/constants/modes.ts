/**
 * Mode Capabilities Constants
 */

import type { ModeCapabilities } from '../types/workflow';
import type { CaptureRole } from '../types/session';

export const MODE_CAPABILITIES: Record<string, ModeCapabilities> = {
  ask: {
    mode: 'ask',
    availableStages: [],
    requiresLLM: true,
    isFullyImplemented: true,
  },
  debugger: {
    mode: 'debugger',
    availableStages: [
      'preflight',
      'entry_gate',
      'speclist',
      'dispatch',
      'investigate',
      'fix_verify',
      'skepti',
      'curate',
      'finalize',
    ],
    requiresLLM: true,
    isFullyImplemented: true,
  },
  analyzer: {
    mode: 'analyzer',
    availableStages: [],
    requiresLLM: false,
    isFullyImplemented: false,
    disabledReason: 'Analyzer is not implemented yet.',
  },
  optimizer: {
    mode: 'optimizer',
    availableStages: [],
    requiresLLM: false,
    isFullyImplemented: false,
    disabledReason: 'Optimizer is not implemented yet.',
  },
};

export function assignDefaultCaptureRoles(count: number): CaptureRole[] {
  const roles: CaptureRole[] = [];
  for (let i = 0; i < count; i++) {
    if (i === 0) roles.push('primary');
    else if (i === 1) roles.push('baseline');
    else roles.push('reference');
  }
  return roles;
}
