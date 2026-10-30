import { translate } from '../../i18n/messages';
const t = (key: import('../../i18n/messages').TranslationKey, params?: Record<string, string | number>) => translate('zh-CN', key, params);
import { expect, it } from 'vitest';
import { groupImageRows } from './groupImageRows';
import { aggregateSectionSteps } from './workProcessToolAggregate';
import type { WorkProcessRow } from './workProcessTypes';
const image = (id: string, status = 'complete', toolName = 'read_image') => ({
  type: 'tool', id, status, toolName, target: id, duration: '1ms',
} as Extract<WorkProcessRow, { type: 'tool' }>);
it('groups successful adjacent reads without losing or deduplicating receipts', () => {
  const rows = [image('a'), image('b')];
  const grouped = groupImageRows(rows);
  expect(grouped).toHaveLength(1);
  expect((grouped[0] as typeof rows[0]).imageCalls).toEqual(rows);
  expect(groupImageRows(grouped)).toEqual(grouped);
});
it.each(['running', 'error', 'cancelled', 'pending'])('never groups across %s', status => {
  expect(groupImageRows([image('a'), image('b', status), image('c')])).toHaveLength(3);
});
it('keeps image groups ahead of the generic eight-tool aggregate', () => {
  const images = Array.from({ length: 25 }, (_, i) => image(String(i)));
  const grouped = aggregateSectionSteps(images, t);
  expect(grouped).toHaveLength(1);
  expect(grouped[0].type).toBe('tool');
  expect((grouped[0] as typeof images[0]).imageCalls).toHaveLength(25);
  expect(groupImageRows([image('a'), image('file', 'complete', 'read_file'), image('b')])).toHaveLength(3);
});
