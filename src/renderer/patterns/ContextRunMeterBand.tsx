import { formatTokenCount } from '@shared/utils/tokens';
import { formatUsdCost } from '@shared/utils/cost';
import { useI18n } from '../i18n';
import type { RunContextUsageSummary } from '@shared/types/session';

const tokens = (value?: number) => value === undefined ? '—' : formatTokenCount(value);
const percent = (value?: number) => value === undefined ? '—' : `${value}%`;
const pair = (first?: number, second?: number) => first === undefined && second === undefined
  ? '—'
  : `${tokens(first)} / ${tokens(second)}`;

function MeterRow({ label, value }: { label: string; value: string }) {
  return <div className="context-breakdown-meter-row"><dt>{label}</dt><dd>{value}</dd></div>;
}

function MeterCard({ id, label, value, children }: {
  id: string; label: string; value: string; children: React.ReactNode;
}) {
  return (
    <section className="context-breakdown-meter-card" data-col={id}>
      <h4>{label}</h4>
      <strong className="context-breakdown-meter-value">{value}</strong>
      <dl className="context-breakdown-meter-details">{children}</dl>
    </section>
  );
}

export function ContextUsageCost({ usage }: { usage: RunContextUsageSummary | null }) {
  const { t } = useI18n();
  const rows = [
    ['contextBreakdown.costThisTurn', usage?.cost?.total],
    ['contextBreakdown.costThisRun', usage?.cumulativeCost],
    ['contextBreakdown.costInput', usage?.cost?.input],
    ['contextBreakdown.costOutput', usage?.cost?.output],
    ['contextBreakdown.costCacheRead', usage?.cost?.cacheRead],
    ['contextBreakdown.costCacheWrite', usage?.cost?.cacheWrite],
  ] as const;
  if (!rows.some(([, value]) => value !== undefined)) return null;
  return (
    <section data-testid="context-breakdown-cost">
      <h3 className="context-breakdown-section-title">{t('contextBreakdown.costLabel')}</h3>
      <dl className="context-breakdown-meter-details">
        {rows.map(([label, value]) => value !== undefined && (
          <MeterRow key={label} label={t(label)} value={formatUsdCost(value)} />
        ))}
      </dl>
    </section>
  );
}

export function ContextRunMeterBand({ usage, preparedInput, historical }: {
  usage: RunContextUsageSummary | null;
  preparedInput?: number;
  historical: boolean;
}) {
  const { t } = useI18n();
  const reasoningShare = usage?.reasoningTokens !== undefined && usage.outputTokens > 0
    && usage.reasoningTokens <= usage.outputTokens
    ? Math.round(usage.reasoningTokens / usage.outputTokens * 100) : undefined;
  return (
    <section className="context-breakdown-run-meter" data-testid="context-breakdown-run-meter"
      data-phase={usage ? 'actual' : preparedInput !== undefined ? 'current' : 'unavailable'}>
      <h3 className="context-breakdown-section-title">
        {t(preparedInput !== undefined ? 'contextBreakdown.requestUsage' : historical && usage
          ? 'contextBreakdown.lastRunTotals' : 'contextBreakdown.runTotals')}
      </h3>
      <div className="context-breakdown-meter-cards">
        <MeterCard id="tokens" label={t('contextBreakdown.totalLabel')} value={tokens(usage?.totalTokens)}>
          <MeterRow label={t('contextBreakdown.inputLabel')} value={preparedInput === undefined ? tokens(usage?.inputTokens) : `~${tokens(preparedInput)}`} />
          <MeterRow label={t('contextBreakdown.outputLabel')} value={tokens(usage?.outputTokens)} />
        </MeterCard>
        <MeterCard id="cache" label={t('contextBreakdown.cacheSavedLabel')} value={tokens(usage?.cacheSavedTokens)}>
          <MeterRow label={t('contextBreakdown.cacheLatestLabel')} value={percent(usage?.lastTurnCacheHitRate)} />
          <MeterRow label={t('contextBreakdown.cacheCumulativeLabel')} value={percent(usage?.cumulativeCacheHitRate)} />
          <MeterRow label={t('contextBreakdown.cacheHitMissShort')} value={pair(usage?.cacheHitTokens, usage?.cacheMissTokens)} />
        </MeterCard>
        <MeterCard id="reasoning" label={t('contextBreakdown.reasoningLabel')} value={tokens(usage?.reasoningTokens)}>
          <MeterRow label={t('contextBreakdown.reasoningShareLabel')} value={percent(reasoningShare)} />
        </MeterCard>
      </div>
    </section>
  );
}
