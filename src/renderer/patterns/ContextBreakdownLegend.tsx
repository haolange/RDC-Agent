import React from 'react';
import type { ContextUsageBreakdownEntry } from '@shared/types/session';
import { useI18n } from '../i18n';
import { formatTokenCount } from '@shared/utils/tokens';
import {
  CONTEXT_BREAKDOWN_GROUPS,
  COUNT_SUFFIX_KEYS,
  SEGMENT_COLOR_VAR,
  SEGMENT_LABEL_KEYS,
} from './contextBreakdownMeta';

export const ContextBreakdownLegend: React.FC<{
  entries: ContextUsageBreakdownEntry[];
}> = ({ entries }) => {
  const { t } = useI18n();

  const renderRow = (entry: ContextUsageBreakdownEntry) => {
    const suffixKey = COUNT_SUFFIX_KEYS[entry.id];
    const suffix = suffixKey ? t(suffixKey) : '';
    const countLabel =
      suffix && entry.count !== undefined
        ? `${entry.count}${suffix}`
        : suffix
          ? `0${suffix}`
          : null;
    const isDeferred = entry.id === 'mcp_tools_deferred';
    const isFree = entry.id === 'free';
    const isZero = !isFree && entry.tokens <= 0;

    return (
      <li
        key={entry.id}
        data-pointer-interactive
        className={`context-breakdown-row${isFree ? ' is-free' : ''}${isDeferred ? ' is-deferred' : ''}${isZero ? ' is-zero' : ''}`}
      >
        <span
          className="context-breakdown-swatch"
          style={{ background: SEGMENT_COLOR_VAR[entry.id] ?? 'var(--token-context-deferred)' }}
          aria-hidden="true"
        />
        <span className="context-breakdown-label">{t(SEGMENT_LABEL_KEYS[entry.id])}</span>
        {countLabel ? <span className="context-breakdown-count">{countLabel}</span> : null}
        <span className="context-breakdown-tokens">{formatTokenCount(entry.tokens)}</span>
      </li>
    );
  };

  return (
    <ul className="context-breakdown-legend">
      {CONTEXT_BREAKDOWN_GROUPS.map((group) => {
        const groupEntries = group.ids.map((id) => {
          const found = entries.find((entry) => entry.id === id);
          return found ?? { id, tokens: 0 };
        });
        return (
          <React.Fragment key={group.id}>
            <li className="context-breakdown-group-header">{t(group.labelKey)}</li>
            {groupEntries.map(renderRow)}
          </React.Fragment>
        );
      })}
    </ul>
  );
};
