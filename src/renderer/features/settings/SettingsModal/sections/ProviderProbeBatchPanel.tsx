import { useAppSettingsStore } from '../../../../stores/appSettingsStore';
import { useProviderProbeBatch } from '../useProviderProbeBatch';
import { Button } from '../../../../ui/Button';
import { Details } from '../../../../ui/Details';
import { InlineError } from '../../../../ui/InlineError';
import { providerProbeResultText } from './providerProbeResultText';
import type { useI18n } from '../../../../i18n';
import './provider-probe-batch.css';

interface Props { providerIds?: string[]; disabled?: boolean; t: ReturnType<typeof useI18n>['t'] }

export function ProviderProbeBatchPanel({ providerIds, disabled, t }: Props) {
  const { batch, busy, error, action, occupied } = useProviderProbeBatch(providerIds);
  const singleService = providerIds?.length === 1;
  const title = t(singleService ? 'settings.providers.batch.serviceTitle' : 'settings.providers.batch.title');
  const hint = t(singleService ? 'settings.providers.batch.serviceHint' : 'settings.providers.batch.hint');
  const complete = batch?.state === 'completed' || batch?.state === 'cancelled';
  const settled = batch?.items.filter(i => i.state !== 'pending' && i.state !== 'running').length ?? 0;
  const usage = batch?.items.reduce((sum, i) => sum + (i.result?.evidence?.usage.totalTokens ?? 0), 0) ?? 0;
  const providers = useAppSettingsStore((state) => state.settings.llm.providers);
  // Results name services and models the way the rest of the page does, never by their ids.
  const providerName = (providerId: string) => providers.find((entry) => entry.id === providerId)?.label ?? providerId;
  const modelName = (providerId: string, modelId: string) => providers.find((entry) => entry.id === providerId)
    ?.models.find((model) => model.id === modelId)?.label ?? modelId;
  return (
    <section className="settings-provider-probe" aria-label={title} data-testid="settings-provider-probe-batch">
      <div className="settings-model-preferences-heading">
        <span className="settings-provider-probe-title">
          <strong>{title}</strong>
          <span className="settings-section-description">{hint}</span>
        </span>
        <div className="settings-model-capability-probe-actions">
          <Button variant="secondary" size="sm" disabled={disabled || busy || occupied} onClick={() => void action('prepare')}>
            {busy ? t('settings.providers.batch.preparing') : t('settings.providers.batch.prepare')}
          </Button>
          {batch?.state === 'ready' ? <Button variant="primary" size="sm" disabled={busy || batch.requestCount === 0} onClick={() => void action('start')}>
            {t('settings.providers.batch.start')}
          </Button> : null}
          {batch && !complete ? <Button variant="ghost" size="sm" disabled={busy || batch.state === 'cancelling'} onClick={() => void action('cancel')}>
            {t('settings.providers.batch.cancel')}
          </Button> : null}
          {complete && batch.items.some(i => i.result && !i.result.success) ? <Button variant="ghost" size="sm" disabled={busy || occupied} onClick={() => void action('retry')}>
            {t('settings.providers.batch.retry')}
          </Button> : null}
        </div>
      </div>
      {error ? <InlineError detail={error}>{t('app.error.actionFailed')}</InlineError> : null}
      {batch ? <>
        <div className="settings-provider-probe-status" role="status" aria-live="polite">
          {t(`settings.providers.batch.state.${batch.state}`)} · {t('settings.providers.batch.counts', { models: batch.modelCount, requests: batch.requestCount, settled, total: batch.items.length, tokens: usage })}
        </div>
        {batch.discoveryErrors.map(entry => (
          <InlineError key={entry.providerId} detail={entry.detail}>
            {t('settings.providers.batch.discoveryFailed', { provider: providerName(entry.providerId) })}
          </InlineError>
        ))}
        <Details summary={t('settings.providers.batch.results')}>
          <ul className="settings-provider-probe-results">
            {batch.items.map(item => {
              const resultText = item.result ? providerProbeResultText(item.result, t) : null;
              const detail = resultText?.detail;
              return <li key={`${item.providerId}:${item.modelId}:${item.mode}`}>
                <strong>{providerName(item.providerId)} · {modelName(item.providerId, item.modelId)}</strong>
                <span>{t(`settings.providers.capability.probeMode.${item.mode}`)} · {resultText?.status
                  ?? t(`settings.providers.batch.item.${item.state}`)}</span>
                {detail ? <span className="settings-provider-probe-detail">{detail}</span> : null}
              </li>;
            })}
          </ul>
        </Details>
      </> : null}
    </section>
  );
}
