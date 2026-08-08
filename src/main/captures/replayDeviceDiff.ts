import type { ReplayDeviceEntry } from '@shared/types/device';

export const POLL_BASE_MS = 5000;
export const POLL_MAX_MS = 60_000;

/** Identity fields used for semantic device equality (excludes heartbeat lastSeen). */
export function deviceIdentityKey(device: ReplayDeviceEntry): string {
  return JSON.stringify({
    id: device.id,
    label: device.label,
    type: device.type,
    status: device.status,
    transport: device.transport,
    serial: device.serial ?? null,
    detailText: device.detailText ?? null,
    lastError: device.lastError ?? null,
    remoteId: device.remoteId ?? null,
    bootstrap: device.bootstrap ?? null,
    activationPhase: device.activationPhase ?? null,
    activationErrorCode: device.activationErrorCode ?? null,
    activationErrorMessage: device.activationErrorMessage ?? null,
    activationUpdatedAt: device.activationUpdatedAt ?? null,
  });
}

export function devicesSemanticallyEqual(
  previous: ReplayDeviceEntry[],
  next: ReplayDeviceEntry[],
): boolean {
  if (previous.length !== next.length) {
    return false;
  }
  for (let index = 0; index < next.length; index += 1) {
    if (deviceIdentityKey(previous[index]!) !== deviceIdentityKey(next[index]!)) {
      return false;
    }
  }
  return true;
}

/** Grow interval on adb failure; reset to BASE when adb is available again. */
export function nextPollIntervalMs(currentIntervalMs: number, adbAvailable: boolean): number {
  if (adbAvailable) {
    return POLL_BASE_MS;
  }
  const doubled = Math.max(currentIntervalMs, POLL_BASE_MS) * 2;
  return Math.min(doubled, POLL_MAX_MS);
}
