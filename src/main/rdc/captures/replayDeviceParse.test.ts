import { describe, expect, it } from 'vitest';
import { parseAdbDeviceLine, parseAndroidBootstrapMetadata } from './replayDeviceParse';

describe('Android service ownership projection', () => {
  it('reports a borrowed connection without claiming APK verification or startup', () => {
    const metadata = parseAndroidBootstrapMetadata({ package_name: 'helper', started_activity: false, installed_apk: false, created_forward: true });
    expect(metadata).toMatchObject({ packageName: 'helper', startedActivity: false, installedApk: false, createdForward: true });
  });
  it('reports startup only when the current native result confirms it', () => {
    expect(parseAndroidBootstrapMetadata({ installed_apk: true })?.startedActivity).toBeUndefined();
    expect(parseAndroidBootstrapMetadata({ started_activity: true })?.startedActivity).toBe(true);
  });
});

it('reports discovery visibility independently from a session connection', () => {
  expect(parseAdbDeviceLine('SERIAL device model:Pixel')).toMatchObject({ status: 'online', adbState: 'device' });
  expect(parseAdbDeviceLine('SERIAL unauthorized')).toMatchObject({ status: 'offline', adbState: 'unauthorized' });
  expect(parseAdbDeviceLine('SERIAL offline')).toMatchObject({ status: 'offline', adbState: 'offline' });
});
