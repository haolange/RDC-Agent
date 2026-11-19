import { Button } from '../../../../ui/Button';
import { Checkbox } from '../../../../ui/Checkbox';
import { Details } from '../../../../ui/Details';
import { InlineError } from '../../../../ui/InlineError';
import { Input } from '../../../../ui/Input';
import { Select } from '../../../../ui/Select';
import { TaskDialog } from '../../../../ui/TaskDialog';
import { useI18n } from '../../../../i18n';
import type { useKnowledgeTopics } from '../useKnowledgeTopics';

export function KnowledgeTopicsDialog({ topics }: { topics: ReturnType<typeof useKnowledgeTopics> }) {
  const { t } = useI18n();
  const preview = topics.preview;
  const labels = new Map([
    ...(topics.proposal?.current.topics ?? []), ...(preview?.topics ?? []),
    ...(preview?.merges.map(item => item.target) ?? []),
  ].map(item => [item.id, item.label]));
  const names = (ids: string[]) => ids.map(id => labels.get(id) ?? id).join(', ') || '—';
  return (
    <TaskDialog open={topics.open} size="lg" title={t('knowledgeCenter.topicsTitle')}
      description={t(preview ? 'knowledgeCenter.topicsPreviewDescription' : 'knowledgeCenter.topicsDescription')}
      onClose={topics.close} closeLabel={t('knowledgeCenter.close')} busy={topics.busy} dataTestId="knowledge-topics-dialog"
      footer={(
        <>
          <Button variant="ghost" disabled={topics.busy} onClick={preview ? () => topics.setPreview(null) : topics.close}>
            {t(preview ? 'knowledgeCenter.topicsBack' : 'knowledgeCenter.confirmCancel')}
          </Button>
          <Button variant="primary" disabled={topics.busy || (!preview && !topics.canPreview)}
            onClick={() => void (preview ? topics.apply() : topics.createPreview())} data-testid="knowledge-topics-next">
            {t(preview ? 'knowledgeCenter.topicsApply' : 'knowledgeCenter.topicsPreview')}
          </Button>
        </>
      )}>
      {topics.busy && !topics.proposal ? <p role="status">{t('knowledgeCenter.loading')}</p> : null}
      {!preview && topics.proposal ? (
        <>
          {topics.suggestions.length === 0 ? <p>{t('knowledgeCenter.topicsNoSuggestions')}</p> : null}
          {topics.suggestions.map(item => {
            const id = item.topic.id;
            const merged = Boolean(topics.mergeTargets[id]);
            const targets = (topics.proposal?.current.topics ?? []).filter(target => target.id !== id);
            return (
              <section className="knowledge-write-section" key={id}>
                <h3 className="knowledge-write-section-title">{item.topic.label}</h3>
                <label className="knowledge-center-field">
                  <span>{t('knowledgeCenter.topicsSynonyms')}</span>
                  <Input value={topics.synonyms[id] ?? item.topic.synonyms.join(', ')} disabled={topics.busy || merged}
                    onChange={event => topics.setSynonyms(current => ({ ...current, [id]: event.target.value }))} />
                </label>
                {item.existing && targets.length ? (
                  <label className="knowledge-center-field">
                    <span>{t('knowledgeCenter.topicsMergeInto')}</span>
                    <Select value={topics.mergeTargets[id] ?? ''} ariaLabel={t('knowledgeCenter.topicsMergeInto')} dataTestId={`knowledge-topics-merge-${id}`}
                      disabled={topics.busy} onChange={value => topics.setMergeTargets(current => ({ ...current, [id]: value }))}
                      options={[{ value: '', label: t('knowledgeCenter.topicsNoMerge') }, ...targets.map(target => ({ value: target.id, label: target.label }))]} />
                  </label>
                ) : null}
                {item.cards.length ? (
                  <Details summary={t('knowledgeCenter.topicsSuggestedCards', { count: item.cards.length })}>
                    {item.cards.map(card => (
                      <Checkbox key={card.cardId} className="knowledge-center-check" disabled={topics.busy || merged}
                        checked={(topics.selected[id] ?? []).includes(card.cardId)}
                        onCheckedChange={checked => topics.toggleCard(id, card.cardId, checked)}
                        label={`${card.title} · ${card.matchedTerms.join(', ')}`} />
                    ))}
                  </Details>
                ) : null}
              </section>
            );
          })}
          <label className="knowledge-center-field">
            <span>{t('knowledgeCenter.topicsNewLabel')}</span>
            <Input value={topics.customLabel} maxLength={120} disabled={topics.busy}
              onChange={event => topics.setCustomLabel(event.target.value)} />
          </label>
          <Button variant="secondary" size="sm" disabled={topics.busy || !topics.customLabel.trim()} onClick={topics.addCustom}>
            {t('knowledgeCenter.topicsAdd')}
          </Button>
        </>
      ) : null}
      {preview ? (
        <>
          {preview.topics.map(topic => <p key={topic.id}><strong>{topic.label}</strong>: {topic.synonyms.join(', ') || '—'}</p>)}
          {preview.merges.map(merge => <p key={merge.source.id}>{merge.source.label} → {merge.target.label} ({merge.target.synonyms.join(', ')})</p>)}
          {preview.cards.map(card => <p key={card.cardId}>{card.title}: {names(card.before)} → {names(card.after)}
            {card.stale ? ` · ${t('knowledgeCenter.topicsStale')}` : ''}</p>)}
        </>
      ) : null}
      {topics.error ? <InlineError>{topics.error}</InlineError> : null}
    </TaskDialog>
  );
}
