/**
 * Mode Capabilities Constants
 */

import type { ModeCapabilities } from '../types/workflow';
import type { CaptureRole } from '../types/session';

export const MODE_CAPABILITIES: Record<string, ModeCapabilities> = {
  general: {
    profileId: 'general',
    requiresLLM: true,
    isFullyImplemented: true,
  },
  debugger: {
    profileId: 'debugger',
    requiresLLM: true,
    isFullyImplemented: true,
  },
  analyzer: {
    profileId: 'analyzer',
    requiresLLM: false,
    isFullyImplemented: false,
    disabledReason: 'Analyzer is not implemented yet.',
  },
  optimizer: {
    profileId: 'optimizer',
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
