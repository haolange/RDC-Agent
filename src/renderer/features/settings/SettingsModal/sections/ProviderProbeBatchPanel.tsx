import { useProviderProbeBatch } from '../useProviderProbeBatch';
import { Button } from '../../../../ui/Button';
import { Details } from '../../../../ui/Details';
import type { useI18n } from '../../../../i18n';
import { providerProbeResultText } from './providerProbeResultText';
import './provider-probe-batch.css';

interface Props { providerIds?: string[]; disabled?: boolean; t: ReturnType<typeof useI18n>['t'] }

export function ProviderProbeBatchPanel({ providerIds, disabled, t }: Props) {
  const { batch, busy, error, action, occupied } = useProviderProbeBatch(providerIds);
  const complete = batch?.state === 'completed' || batch?.state === 'cancelled';
  const settled = batch?.items.filter(i => i.state !== 'pending' && i.state !== 'running').length ?? 0;
  const usage = batch?.items.reduce((sum, i) => sum + (i.result?.evidence?.usage.totalTokens ?? 0), 0) ?? 0;
  return (
    <section className="settings-provider-probe" aria-label={t('settings.providers.batch.title')} data-testid="settings-provider-probe-batch">
      <div className="settings-model-preferences-heading">
        <strong>{t('settings.providers.batch.title')}</strong>
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
      <p className="settings-help-text">{t('settings.providers.batch.hint')}</p>
      {error ? <div className="settings-model-capability-note settings-model-capability-note--error" role="alert">{error}</div> : null}
      {batch ? <>
        <div className="settings-help-text" role="status" aria-live="polite">
          {t(`settings.providers.batch.state.${batch.state}`)} · {t('settings.providers.batch.counts', { models: batch.modelCount, requests: batch.requestCount, settled, total: batch.items.length, tokens: usage })}
        </div>
        {batch.discoveryErrors.map(entry => <div className="settings-model-capability-note settings-model-capability-note--warning" key={entry.providerId}>
          {entry.providerId}: {entry.detail}
        </div>)}
        <Details summary={t('settings.providers.batch.results')}>
          <ul className="settings-provider-probe-results">
            {batch.items.map(item => {
              const resultText = item.result ? providerProbeResultText(item.result, t) : null;
              const detail = resultText?.detail ?? item.detail;
              return <li key={`${item.providerId}:${item.modelId}:${item.mode}`}>
                <strong>{item.providerId} / {item.modelId}</strong>
                <span>{t(`settings.providers.capability.probeMode.${item.mode}`)} · {resultText?.status
                  ?? t(`settings.providers.batch.item.${item.state}`)}</span>
                {detail ? <span className="settings-help-text">{detail}</span> : null}
                {resultText?.tiers ? <span className="settings-help-text">{resultText.tiers}</span> : null}
              </li>;
            })}
          </ul>
        </Details>
      </> : null}
    </section>
  );
}
