import { describe, expect, it } from 'vitest';
import { buildRemoteReadyText, parseAndroidBootstrapMetadata } from './replayDeviceParse';

describe('Android service ownership projection', () => {
  it('reports a borrowed connection without claiming APK verification or startup', () => {
    const metadata = parseAndroidBootstrapMetadata({ package_name: 'helper', started_activity: false, installed_apk: false, created_forward: true });
    expect(buildRemoteReadyText(metadata)).toBe('Connected to Android RenderDoc server');
  });
  it('reports startup only when the current native result confirms it', () => {
    expect(buildRemoteReadyText({ installedApk: true })).not.toContain('Started');
    expect(buildRemoteReadyText({ startedActivity: true })).toBe('Started Android RenderDoc and connected');
  });
});
