import { formatDuration } from '../../lib/formatTime';
import type { AppLanguage } from '@shared/types/settings';

export const normalizeWorkProcessText = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) return '';
  return trimmed
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .trim();
};

/** Time from `start` to `end` (or to now, for something still running) in the interface language; empty without a start. */
export const formatDurationMs = (language: AppLanguage, start?: number, end?: number): string => (
  start ? formatDuration(language, (end ?? Date.now()) - start) : ''
);

export const compactText = (value: string, maxLength: number): string => {
  const text = value.trim().replace(/\s+/g, ' ');
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 3))}...`;
};
