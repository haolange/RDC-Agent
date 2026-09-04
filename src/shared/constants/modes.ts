/**
 * Capture role defaults for multi-capture sessions.
 */

import type { CaptureRole } from '../types/session';

export function assignDefaultCaptureRoles(count: number): CaptureRole[] {
  const roles: CaptureRole[] = [];
  for (let i = 0; i < count; i++) {
    if (i === 0) roles.push('primary');
    else if (i === 1) roles.push('baseline');
    else roles.push('reference');
  }
  return roles;
}
