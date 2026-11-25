import type { AppLanguage } from '@shared/types/settings';

/**
 * Durations, clock times and dates in the interface language, through `Intl` (formatters are cached per language and
 * shape). English keeps the long-standing shapes exactly: 850ms, 1.2s, 3m 05s; 09:30; other languages use their own
 * units and date order.
 */
const formatters = new Map<string, Intl.NumberFormat | Intl.DateTimeFormat>();
const cached = <T extends Intl.NumberFormat | Intl.DateTimeFormat>(key: string, create: () => T): T => {
  const existing = formatters.get(key);
  if (existing) return existing as T;
  const formatter = create();
  formatters.set(key, formatter);
  return formatter;
};
const unit = (language: AppLanguage, name: 'millisecond' | 'second' | 'minute', options: Intl.NumberFormatOptions = {}) => cached(
  `${language}:${name}:${JSON.stringify(options)}`,
  () => new Intl.NumberFormat(language, { style: 'unit', unit: name, unitDisplay: 'narrow', ...options }),
);

/** A duration: milliseconds below a second, one decimal below a minute, then minutes and two-digit seconds. */
export function formatDuration(language: AppLanguage, ms: number): string {
  const value = Math.max(0, ms);
  if (value < 1000) return unit(language, 'millisecond').format(value);
  if (value < 60_000) return unit(language, 'second', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value / 1000);
  const minutes = Math.floor(value / 60_000);
  const seconds = Math.floor((value % 60_000) / 1000);
  return `${unit(language, 'minute').format(minutes)} ${unit(language, 'second', { minimumIntegerDigits: 2 }).format(seconds)}`;
}

/** Hours and minutes on a 24-hour clock, the time a message was sent. */
export function formatClockTime(language: AppLanguage, epoch: number): string {
  if (!Number.isFinite(epoch) || epoch <= 0) return '';
  return cached(`${language}:clock`, () => new Intl.DateTimeFormat(language, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }))
    .format(epoch);
}

/** A calendar date with the time of day, for records such as knowledge cards and index builds. */
export function formatDateTime(language: AppLanguage, epoch: number | undefined): string {
  if (epoch == null || !Number.isFinite(epoch)) return '';
  return cached(`${language}:datetime`, () => new Intl.DateTimeFormat(language, {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  })).format(epoch);
}
