import { afterEach, expect, it } from 'vitest';
import { localizedTranslator } from '../../i18n/messages';
import { useNotificationStore } from '../../stores/notificationStore';
import { announcePreviousInstance } from './previousInstanceNotice';

afterEach(() => useNotificationStore.setState({ notifications: [] }));

it('raises a sticky failure in the interface language with the launch facts behind Copy details', () => {
  announcePreviousInstance(
    {
      classification: 'killed-or-power-loss-suspected',
      instanceId: 'previous-instance',
      pid: 4242,
      lastRecordAt: Date.parse('2026-11-26T10:00:00.000Z'),
      lastRecord: 'turn_started',
      crashFiles: 0,
      interruptedTurns: [{ sessionId: 'session-1', turnId: 'turn-1' }],
    },
    localizedTranslator('zh-CN'),
  );
  const [notice] = useNotificationStore.getState().notifications;
  expect(notice?.tone).toBe('error');
  expect(notice?.title).toBe(localizedTranslator('zh-CN')('errors.PREVIOUS_INSTANCE_KILLED'));
  expect(notice?.details).toEqual(
    expect.arrayContaining([
      { label: 'Code', value: 'PREVIOUS_INSTANCE_KILLED' },
      { label: 'Classification', value: 'killed-or-power-loss-suspected' },
      { label: 'Previous pid', value: '4242' },
      { label: 'Last record at', value: '2026-11-26T10:00:00.000Z' },
      { label: 'Interrupted turn', value: 'session-1 / turn-1' },
    ]),
  );
});
