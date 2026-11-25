import { expect, it } from 'vitest';
import { formatClockTime, formatDateTime, formatDuration } from './formatTime';

it('keeps the English shapes and formats other languages with their own units and date order', () => {
  expect([850, 1_240, 59_940, 185_000].map((ms) => formatDuration('en', ms))).toEqual(['850ms', '1.2s', '59.9s', '3m 05s']);
  expect(formatDuration('zh-CN', 1_240)).toBe(new Intl.NumberFormat('zh-CN', {
    style: 'unit', unit: 'second', unitDisplay: 'narrow', minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(1.24));
  expect(formatDuration('en', -5)).toBe('0ms');
  const morning = new Date(2026, 10, 25, 9, 5).getTime();
  expect(formatClockTime('en', morning)).toBe('09:05');
  expect(formatClockTime('zh-CN', morning)).toBe('09:05');
  expect(formatClockTime('en', 0)).toBe('');
  expect(formatDateTime('zh-CN', morning)).toBe('2026/11/25 09:05');
  expect(formatDateTime('en', morning)).toBe('11/25/2026, 09:05');
  expect(formatDateTime('en', undefined)).toBe('');
});
