import React, { useEffect, useId, useRef, useState } from 'react';
import { cn } from '../../../lib/cn';
import { SearchField } from '../../../ui/SearchField';
import { SettingsNavIcon } from './SettingsNavIcon';
import {
  matchSettingsSearchEntries,
  type SettingsSearchEntry,
} from './settingsSearchIndex';
import type { TranslationKey } from '../../../i18n';
import type { SettingsSection } from './types';

const GROUP_LABELS: Partial<Record<SettingsSection, TranslationKey>> = {
  general: 'settings.navPersonal',
  models: 'settings.navConnections',
  agents: 'settings.navAgentConfiguration',
};

/** A model service the search can jump to, so a provider is found by its name. */
export interface SettingsSearchProvider {
  id: string;
  label: string;
  open: () => void;
}

export function focusSettingsSearchTarget(target: string): void {
  const node = document.querySelector<HTMLElement>(`[data-settings-search="${target}"]`);
  if (!node) return;
  node.scrollIntoView({
    block: 'center',
    behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
  });
  node.classList.add('is-settings-search-hit');
  window.setTimeout(() => node.classList.remove('is-settings-search-hit'), 1600);
}

export const SettingsCenterNav: React.FC<{
  sections: Array<{ id: SettingsSection; label: string }>;
  activeSection: SettingsSection;
  onSelectSection: (section: SettingsSection) => void;
  providers: SettingsSearchProvider[];
  t: (key: TranslationKey) => string;
}> = ({ sections, activeSection, onSelectSection, providers, t }) => {
  const [query, setQuery] = useState('');
  const [activeResult, setActiveResult] = useState(0);
  const resultsId = useId();
  const navRef = useRef<HTMLDivElement>(null);
  const [horizontal, setHorizontal] = useState(() => window.matchMedia('(max-width: 960px)').matches);
  const selectEntry = (entry: SettingsSearchEntry) => {
    onSelectSection(entry.section);
    window.setTimeout(() => focusSettingsSearchTarget(entry.target), 50);
    setQuery('');
  };

  // Cheap to compute; the index and the provider list are both small.
  const results = (() => {
    const normalized = query.trim().toLowerCase();
    const providerHits = normalized ? providers.filter((provider) => provider.label.toLowerCase().includes(normalized)).slice(0, 6) : [];
    return [
      ...matchSettingsSearchEntries(query, t).map((entry) => ({ key: entry.id, title: t(entry.titleKey), section: entry.section,
        select: () => selectEntry(entry) })),
      ...providerHits.map((provider) => ({ key: `provider-${provider.id}`, title: provider.label, section: 'models' as SettingsSection,
        select: () => { setQuery(''); provider.open(); } })),
    ];
  })();
  useEffect(() => setActiveResult(0), [query]);

  useEffect(() => {
    const media = window.matchMedia('(max-width: 960px)');
    const updateOrientation = () => setHorizontal(media.matches);
    media.addEventListener('change', updateOrientation);
    return () => media.removeEventListener('change', updateOrientation);
  }, []);

  useEffect(() => {
    const items = navRef.current?.querySelectorAll<HTMLButtonElement>('[data-settings-nav-item="true"]');
    items?.forEach((item) => {
      item.tabIndex = item.dataset.section === activeSection ? 0 : -1;
      if (horizontal && item.tabIndex === 0) {
        item.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }
    });
  }, [activeSection, horizontal, sections]);

  // The field keeps focus; arrows move the active result, Enter opens it, Escape clears the search.
  const handleSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape' && query) { event.preventDefault(); event.stopPropagation(); setQuery(''); return; }
    if (results.length === 0) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveResult((index) => (index + (event.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      results[Math.min(activeResult, results.length - 1)].select();
    }
  };

  const handleNavKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>('[data-settings-nav-item="true"]'),
    );
    if (items.length === 0) return;
    const currentIndex = items.findIndex((item) => item === document.activeElement);
    let nextIndex: number | null = null;
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
      nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % items.length;
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
      nextIndex = currentIndex < 0 ? items.length - 1 : (currentIndex - 1 + items.length) % items.length;
    } else if (event.key === 'Home') {
      nextIndex = 0;
    } else if (event.key === 'End') {
      nextIndex = items.length - 1;
    }
    if (nextIndex == null) return;
    event.preventDefault();
    items[nextIndex]?.focus();
    onSelectSection(items[nextIndex].dataset.section as SettingsSection);
  };

  return (
    <>
      <SearchField
        className="settings-center-search"
        value={query}
        data-testid="settings-nav-search"
        placeholder={t('settings.searchPlaceholder')}
        aria-label={t('settings.searchPlaceholder')}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={handleSearchKeyDown}
        onClear={() => setQuery('')}
        clearLabel={t('app.clearSearch')}
        role="combobox"
        aria-expanded={results.length > 0}
        aria-controls={resultsId}
        aria-activedescendant={results.length > 0 ? `${resultsId}-${Math.min(activeResult, results.length - 1)}` : undefined}
      />
      {results.length > 0 ? (
        <div id={resultsId} className="settings-search-results" role="listbox" data-testid="settings-search-results">
          {results.map((entry, index) => (
            <button
              key={entry.key}
              id={`${resultsId}-${index}`}
              type="button"
              role="option"
              tabIndex={-1}
              aria-selected={index === activeResult}
              className={cn('settings-search-result', index === activeResult && 'is-active')}
              data-testid={`settings-search-result-${entry.key}`}
              onMouseEnter={() => setActiveResult(index)}
              onClick={entry.select}
            >
              <span>{entry.title}</span>
              <span className="settings-search-result-section">
                {sections.find((section) => section.id === entry.section)?.label}
              </span>
            </button>
          ))}
        </div>
      ) : null}
      <div
        ref={navRef}
        className="settings-center-nav"
        role="tablist"
        aria-orientation={horizontal ? 'horizontal' : 'vertical'}
        onKeyDown={handleNavKeyDown}
      >
        {sections.map((section) => {
          const group = GROUP_LABELS[section.id];
          return (
            <React.Fragment key={section.id}>
              {group ? <span className="settings-center-nav-group" role="presentation">{t(group)}</span> : null}
              <button
                type="button"
                className={cn('settings-center-nav-item', activeSection === section.id && 'is-active')}
                data-testid={`settings-nav-${section.id}`}
                data-settings-nav-item="true"
                data-section={section.id}
                role="tab"
                aria-selected={activeSection === section.id}
                onClick={() => onSelectSection(section.id)}
              >
                <SettingsNavIcon section={section.id} />
                <span>{section.label}</span>
              </button>
            </React.Fragment>
          );
        })}
      </div>
    </>
  );
};
