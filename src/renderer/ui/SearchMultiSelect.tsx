import { useId, useState, type ReactNode } from 'react';
import { cn } from '../lib/cn';
import { Button } from './Button';
import { InlineError } from './InlineError';
import { Checkbox } from './Checkbox';
import { SearchField } from './SearchField';
import { filterMultiSelectOptions, toggleMultiSelectId, type SearchMultiSelectOption } from './searchMultiSelectModel';
import './SearchMultiSelect.css';
import { Icon } from './Icon';

export type { SearchMultiSelectOption } from './searchMultiSelectModel';

export interface SearchMultiSelectProps {
  value: readonly string[];
  options: readonly SearchMultiSelectOption[];
  onChange: (value: string[]) => void;
  /** Selected references must be retained even if the catalog no longer contains them. */
  unavailable?: Readonly<Record<string, string>>;
  loading?: boolean;
  /** One human sentence; the technical reason goes in `errorDetail`, which only "Copy details" carries. */
  error?: ReactNode;
  errorDetail?: string;
  disabled?: boolean;
  onRetry?: () => void;
  label: string;
  searchLabel: string;
  emptyLabel: string;
  noResultsLabel: string;
  loadingLabel: string;
  unavailableLabel: string;
  removeLabel: (id: string) => string;
  retryLabel?: string;
}

/** Presentational catalog picker. Resolution, permissions and persistence belong to its caller. */
export function SearchMultiSelect({ value, options, onChange, unavailable = {}, loading = false,
  error, errorDetail, disabled = false, onRetry, label, searchLabel, emptyLabel, noResultsLabel,
  loadingLabel, unavailableLabel, removeLabel, retryLabel }: SearchMultiSelectProps) {
  const [query, setQuery] = useState('');
  const id = useId();
  const candidates = filterMultiSelectOptions(options, query);
  const selected = [...new Set(value)];
  const catalog = new Map(options.map((option) => [option.id, option]));
  return (
    <div className={cn('ui-search-multi-select', disabled && 'is-disabled')} role="group"
      aria-labelledby={`${id}-label`} aria-busy={loading}>
      <span id={`${id}-label`} className="ui-search-multi-select-label">{label}</span>
      {selected.length > 0 && <ul className="ui-search-multi-select-selected">
        {selected.map((selectedId) => {
          const option = catalog.get(selectedId);
          const reason = unavailable[selectedId] ?? (!loading && !error && (!option || option.disabled) ? unavailableLabel : undefined);
          return <li key={selectedId} className={cn('ui-search-multi-select-selection', reason && 'is-unavailable')}>
            <span>{option?.label ?? selectedId}{reason && <small>{reason}</small>}</span>
            <Button size="sm" variant="ghost" disabled={disabled} aria-label={removeLabel(selectedId)}
              onClick={() => onChange(toggleMultiSelectId(value, selectedId, false))}><Icon name="close" size={14} /></Button>
          </li>;
        })}
      </ul>}
      <SearchField aria-label={searchLabel} placeholder={searchLabel} value={query} disabled={disabled}
        onChange={(event) => setQuery(event.currentTarget.value)} />
      <div aria-live="polite" className="ui-search-multi-select-status">
        {error ? <InlineError detail={errorDetail} onRetry={onRetry} retryLabel={retryLabel} retryDisabled={disabled || loading}>{error}</InlineError>
          : loading ? loadingLabel : candidates.length === 0 ? (query.trim() ? noResultsLabel : emptyLabel) : null}
      </div>
      {candidates.length > 0 && <ul className="ui-search-multi-select-options">
        {candidates.map((option) => <li key={option.id}>
          <Checkbox checked={selected.includes(option.id)} label={option.label}
            disabled={disabled || loading || Boolean(error) || option.disabled || Boolean(unavailable[option.id])}
            onCheckedChange={(checked) => onChange(toggleMultiSelectId(value, option.id, checked))}
            trailing={<small>{option.id}{option.source ? ` · ${option.source}` : ''}</small>} />
        </li>)}
      </ul>}
    </div>
  );
}
