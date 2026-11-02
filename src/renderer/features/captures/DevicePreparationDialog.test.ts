// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { DevicePreparationDialog } from './DevicePreparationDialog';
import { useDeviceStore } from '../../stores/deviceStore';
import { useSessionDeviceStore } from '../../stores/sessionDeviceStore';
import { replayFixture } from '../../testing/replayFixture';
import { translate } from '../../i18n/messages';

const locale = vi.hoisted(() => ({ language: 'en' as 'en' | 'zh-CN' }));
vi.mock('../../i18n', () => ({ useI18n: () => ({ t: (key: Parameters<typeof translate>[1], params?: Parameters<typeof translate>[2]) => translate(locale.language, key, params) }) }));
vi.mock('../../stores/projectStore', () => ({ useProjectStore: (selector: (state: { currentSession: { sessionId: string } }) => unknown) => selector({ currentSession: { sessionId: 'session' } }) }));
afterEach(() => { vi.unstubAllGlobals(); });

it.each(['en', 'zh-CN'] as const)('localizes Local in the real close confirmation and preserves Android names (%s)', async (language) => {
  locale.language = language;
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  useDeviceStore.setState({ devices: [
    { id: 'local', type: 'local', label: 'Local', status: 'online', transport: 'local' },
    { id: 'android', type: 'android', label: 'RMX3551 用户设备', status: 'online', transport: 'adb_android' },
  ] });
  const confirmation = (deviceId: string) => ({ scope: { projectId: 'project', sessionId: 'session' }, deviceId,
    result: { success: false, state: replayFixture(), confirmation: { token: 'opaque', kind: 'close_capture' as const } },
  });
  useSessionDeviceStore.setState({ confirmation: confirmation('local'), confirming: false });
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(createElement(DevicePreparationDialog)));
    const detail = () => document.querySelector('[role="alertdialog"] .confirmation-detail');
    expect(detail()?.querySelector('dt')?.textContent).toBe(translate(language, 'device.prepare.target'));
    expect(detail()?.querySelector('dd')?.textContent).toBe(translate(language, 'device.local'));
    await act(async () => useSessionDeviceStore.setState({ confirmation: confirmation('android') }));
    expect(detail()?.querySelector('dd')?.textContent).toBe('RMX3551 用户设备');
  } finally { await act(async () => root.unmount()); host.remove(); useSessionDeviceStore.setState({ confirmation: null }); }
});
