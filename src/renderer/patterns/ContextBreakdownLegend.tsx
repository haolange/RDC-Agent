import React from 'react';
import { formatTokenCount } from '@shared/utils/tokens';
import { useI18n } from '../i18n';
import {
  CONTEXT_BREAKDOWN_GROUPS,
  COUNT_SUFFIX_KEYS,
  SEGMENT_LABEL_KEYS,
} from './contextBreakdownMeta';
import type { ContextUsageBreakdownEntry } from '@shared/types/session';

export const ContextBreakdownLegend: React.FC<{
  entries: ContextUsageBreakdownEntry[];
  unavailable?: boolean;
  estimatedFreeSpace?: boolean;
}> = ({ entries, unavailable = false, estimatedFreeSpace = false }) => {
  const { t } = useI18n();

  const renderRow = (entry: ContextUsageBreakdownEntry, knownEmpty: boolean) => {
    const suffixKey = COUNT_SUFFIX_KEYS[entry.id];
    const suffix = suffixKey ? t(suffixKey) : '';
    const countLabel = !suffixKey
      ? null
      : unavailable
        ? '—'
        : entry.count !== undefined
          ? `${entry.count}${suffix}`
          : knownEmpty
            ? `0${suffix}`
            : '—';
    const isDeferred = entry.id === 'mcp_tools_deferred' || entry.id === 'builtin_tools_deferred';
    const isFree = entry.id === 'free';
    const isZero = !unavailable && !isFree && entry.tokens <= 0;

    return (
      <li
        key={entry.id}
        className={`context-breakdown-row${isFree ? ' is-free' : ''}${isDeferred ? ' is-deferred' : ''}${isZero ? ' is-zero' : ''}`}
      >
        <span
          className="context-breakdown-swatch"
          data-segment={entry.id}
          aria-hidden="true"
        />
        <span className="context-breakdown-label">{t(SEGMENT_LABEL_KEYS[entry.id])}</span>
        {countLabel ? <span className="context-breakdown-count">{countLabel}</span> : null}
        <span className="context-breakdown-tokens">
          {unavailable ? '—' : `${isFree && estimatedFreeSpace ? '~' : ''}${formatTokenCount(entry.tokens)}`}
        </span>
      </li>
    );
  };

  return (
    <ul className="context-breakdown-legend">
      {CONTEXT_BREAKDOWN_GROUPS.map((group) => {
        const groupEntries = group.ids.map((id) => {
          const found = entries.find((entry) => entry.id === id);
          return { entry: found ?? { id, tokens: 0 }, knownEmpty: found === undefined };
        });
        return (
          <React.Fragment key={group.id}>
            <li className="context-breakdown-group-header">{t(group.labelKey)}</li>
            {groupEntries.map(({ entry, knownEmpty }) => renderRow(entry, knownEmpty))}
          </React.Fragment>
        );
      })}
    </ul>
  );
};
