import { useMemo, useState } from 'react';
import { Button } from '../../../../ui/Button';
import { Chevron } from '../../../../ui/Chevron';
import { Details } from '../../../../ui/Details';
import { EmptyState } from '../../../../ui/EmptyState';
import { SearchField } from '../../../../ui/SearchField';
import { Select } from '../../../../ui/Select';
import { getProviderCategoryTranslation } from '../utils';
import { useI18n } from '../../../../i18n';
import { ProviderMark } from './ProviderMark';
import { directoryCategory, directoryGroups, isSuggestedProvider } from './providerDirectoryModel';
import { connectHintKey, isProviderActionBlocked } from './providerCardModel';
import type { ProviderCatalogCategory } from '../types';
import type { LlmProviderEntry } from '@shared/types/settings';
import type { Ref } from 'react';

interface Props {
  entries: LlmProviderEntry[];
  categories: ProviderCatalogCategory[];
  onChoose: (entry: LlmProviderEntry) => void;
  searchRef?: Ref<HTMLInputElement>;
}

export function ProviderDirectory({ entries, categories, onChoose,  searchRef }: Props) {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const [choice, setFilter] = useState('recommended');
  const hasSuggestions = entries.some(entry => isSuggestedProvider(entry.id));
  const filter = !hasSuggestions && choice === 'recommended' ? 'all' : choice;
  const groups = useMemo(() => directoryGroups(entries, filter, query, t), [entries, filter, query, t]);
  const options = [
    ...(hasSuggestions ? [{ value: 'recommended', label: t('settings.directory.suggested') }] : []),
    { value: 'all', label: t('settings.directory.all') },
    ...categories.map(({ id }) => ({ value: id, label: t(getProviderCategoryTranslation(id)) })),
  ];
  const renderEntry = (entry: LlmProviderEntry) => (
    <Button key={entry.id} variant="ghost" className="settings-directory-item" disabled={isProviderActionBlocked(entry)}
      onClick={() => onChoose(entry)} data-testid={`settings-provider-connect-${entry.id}`}>
      <ProviderMark id={entry.id} category={directoryCategory(entry)} size={20} />
      <span className="settings-directory-name">{entry.label}</span>
      <span className="settings-directory-hint">{t(isProviderActionBlocked(entry) ? 'settings.providerUnavailableAction' : connectHintKey(entry))}</span>
      <Chevron direction="right" size={14} />
    </Button>
  );
  const custom = filter === 'recommended' && !query.trim()
    ? entries.filter((entry) => entry.endpointClass === 'user-endpoint') : [];
  return <section className="settings-provider-directory" aria-label={t('settings.directory.add')}>
    <div className="settings-directory-filters">
      <SearchField ref={searchRef} className="settings-provider-search" value={query} aria-label={t('settings.searchProviders')}
        placeholder={t('settings.searchProviders')} onChange={e => setQuery(e.target.value)}
        onClear={() => setQuery('')} clearLabel={t('app.clearSearch')} data-testid="settings-provider-search" />
      <Select value={query.trim() && filter === 'recommended' ? 'all' : filter} options={options}
        ariaLabel={t('settings.directory.category')} dataTestId="settings-provider-category"
        onChange={value => { setFilter(value); if (value === 'recommended') setQuery(''); }} />
    </div>
    <div className="settings-directory-list">
      {groups.map(({ key, label, entries: members }) => members.length === 1 ? renderEntry(members[0]!) : (
        <Details key={key} className="settings-directory-family" summary={<>
          <ProviderMark id={members[0]!.id} category={directoryCategory(members[0]!)} size={20} />
          <span>{label}</span>
        </>}>
          <div className="settings-directory-members">{members.map(renderEntry)}</div>
        </Details>
      ))}
      {!groups.length && (filter !== 'recommended' || query.trim()) ? <EmptyState title={t('settings.providerSearchEmpty')} /> : null}
    </div>
    {filter === 'recommended' && !query.trim() ? <div className="settings-directory-other">
      <Button size="sm" onClick={() => setFilter('all')}>{t('settings.directory.all')}</Button>
      {custom.length > 0 ? <Details summary={t('settings.directory.custom')}>
        <div className="settings-directory-members">{custom.map(renderEntry)}</div>
      </Details> : null}
    </div> : null}
  </section>;
}
