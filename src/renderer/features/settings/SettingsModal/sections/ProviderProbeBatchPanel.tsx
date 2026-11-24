import { useState } from 'react';
import { useAppSettingsStore } from '../../../../stores/appSettingsStore';
import { useProviderProbeBatch } from '../useProviderProbeBatch';
import { Button } from '../../../../ui/Button';
import { Details } from '../../../../ui/Details';
import { InlineError } from '../../../../ui/InlineError';
import { TaskDialog } from '../../../../ui/TaskDialog';
import { providerProbeResultText } from './providerProbeResultText';
import type { useI18n } from '../../../../i18n';
import './provider-probe-batch.css';

interface Props { providerIds?: string[]; disabled?: boolean; t: ReturnType<typeof useI18n>['t'] }

export function ProviderProbeBatchPanel({ providerIds, disabled, t }: Props) {
  const [open, setOpen] = useState(false);
  const { batch, busy, error, action, occupied } = useProviderProbeBatch(providerIds);
  const singleService = providerIds?.length === 1;
  const title = t(singleService ? 'settings.providers.batch.serviceTitle' : 'settings.providers.batch.title');
  const complete = batch?.state === 'completed' || batch?.state === 'cancelled';
  const settled = batch?.items.filter(i => i.state !== 'pending' && i.state !== 'running').length ?? 0;
  const failed = batch ? batch.discoveryErrors.length + batch.items.filter(({ result }) => result?.status === 'failed' || result?.status === 'denied').length : 0;
  const usage = batch?.items.reduce((sum, i) => sum + (i.result?.evidence?.usage.totalTokens ?? 0), 0) ?? 0;
  const providers = useAppSettingsStore((state) => state.settings.llm.providers);
  // Results name services and models the way the rest of the page does, never by their ids.
  const providerName = (providerId: string) => providers.find((entry) => entry.id === providerId)?.label ?? providerId;
  const modelName = (providerId: string, modelId: string) => providers.find((entry) => entry.id === providerId)
    ?.models.find((model) => model.id === modelId)?.label ?? modelId;
  const ready = batch?.state === 'ready';
  const review = () => {
    setOpen(true);
    if (!batch && !busy && !occupied) void action('prepare');
  };
  const progress = error ? t('app.error.actionFailed') : batch
    ? [t(`settings.providers.batch.state.${batch.state}`), t('settings.providers.batch.progress', { settled, total: batch.items.length }),
      ...(failed ? [t('settings.providers.batch.failedCount', { count: failed })] : [])].join(' · ')
    : t('settings.providers.batch.preparing');

  return (
    <>
      <div className="settings-provider-probe-launcher">
        <Button size="sm" variant={singleService ? 'ghost' : 'secondary'} aria-haspopup="dialog"
          disabled={disabled || (occupied && !batch)} onClick={review}>
          {singleService ? t('settings.providers.batch.serviceAction') : title}
        </Button>
        {!open && (error || batch || busy) && !singleService
          ? <span role="status" className="settings-provider-probe-status">{progress}</span> : null}
      </div>
      <TaskDialog open={open} title={title} description={singleService ? providerName(providerIds[0]) : undefined}
        onClose={() => setOpen(false)} closeLabel={t('dialog.close')} size="sm"
        footer={(batch || error) ? <>
          {complete || (!batch && error) ? <Button variant="secondary" disabled={disabled || busy || occupied}
            onClick={() => void action('prepare')}>{t('settings.providers.batch.prepare')}</Button> : null}
          {batch && !complete ? <Button variant={ready ? 'ghost' : 'secondary'} disabled={busy || batch.state === 'cancelling'}
            onClick={() => void action('cancel')}>{t('settings.providers.batch.cancel')}</Button> : null}
          {complete && batch.items.some(i => i.result && !i.result.success) ? <Button variant="primary" disabled={disabled || busy || occupied}
            onClick={() => void action('retry')}>{t('settings.providers.batch.retry')}</Button> : null}
          {ready ? <Button variant="primary" disabled={disabled || busy || batch.requestCount === 0}
            onClick={() => void action('start')}>{t('settings.providers.batch.start')}</Button> : null}
        </> : undefined}>
        <section className="settings-provider-probe" aria-label={title} data-testid="settings-provider-probe-batch">
          {error ? <InlineError detail={error}>{t('app.error.actionFailed')}</InlineError> : null}
          {batch ? <>
            <dl className="settings-provider-probe-totals">
              <div><dt>{t('settings.providers.batch.models')}</dt><dd>{batch.modelCount}</dd></div>
              <div><dt>{t('settings.providers.batch.requests')}</dt><dd>{batch.requestCount}</dd></div>
            </dl>
            {ready ? <p className="settings-section-description">{t(batch.requestCount
              ? 'settings.providers.batch.hint' : 'settings.providers.batch.empty')}</p> :
              <p className="settings-provider-probe-status" role="status">{progress} · {t('settings.providers.batch.usage', { tokens: usage })}</p>}
            {batch.discoveryErrors.map(entry => (
              <InlineError key={entry.providerId} detail={entry.detail}>
                {t('settings.providers.batch.discoveryFailed', { provider: providerName(entry.providerId) })}
              </InlineError>
            ))}
            {batch.items.length > 0 ? <Details summary={t(ready ? 'settings.providers.batch.review' : 'settings.providers.batch.results')}>
              <ul className="settings-provider-probe-results">
                {batch.items.map(item => {
                  const resultText = item.result ? providerProbeResultText(item.result, t) : null;
                  const detail = resultText?.detail;
                  return <li key={`${item.providerId}:${item.modelId}:${item.mode}`}>
                    <strong>{singleService ? null : `${providerName(item.providerId)} · `}{modelName(item.providerId, item.modelId)}</strong>
                    <span>{t(`settings.providers.capability.probeMode.${item.mode}`)} · {resultText?.status
                      ?? t(`settings.providers.batch.item.${item.state}`)}</span>
                    {detail ? <span className="settings-provider-probe-detail">{detail}</span> : null}
                  </li>;
                })}
              </ul>
            </Details> : null}
          </> : busy || occupied ? <p role="status">{t(occupied ? 'settings.providers.batch.occupied' : 'settings.providers.batch.preparing')}</p> : null}
        </section>
      </TaskDialog>
    </>
  );
}
