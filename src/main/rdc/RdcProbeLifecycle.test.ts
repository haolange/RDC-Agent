import { describe, expect, it } from 'vitest';
import { selectedProbeDeviceId } from './RdcProbeLifecycle';

describe('probe device selection', () => {
  it('uses the existing prepared Android selection without falling back to Local', () => {
    expect(selectedProbeDeviceId({ replayDeviceId: null, preparation: { targetDeviceId: 'android-1', phase: 'ready', issue: null } })).toBe('android-1');
  });
  it('rejects missing, unready or inconsistent device selection', () => {
    expect(() => selectedProbeDeviceId({ replayDeviceId: null, preparation: { targetDeviceId: null, phase: 'idle', issue: null } })).toThrow('RDC_PROBE_DEVICE_REQUIRED');
    expect(() => selectedProbeDeviceId({ replayDeviceId: 'android-1', preparation: { targetDeviceId: 'android-1', phase: 'failed', issue: null } })).toThrow('RDC_PROBE_DEVICE_REQUIRED');
    expect(() => selectedProbeDeviceId({ replayDeviceId: 'android-1', preparation: { targetDeviceId: 'local', phase: 'ready', issue: null } })).toThrow('RDC_PROBE_DEVICE_MISMATCH');
  });
});
