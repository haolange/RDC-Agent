import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { TranslationKey } from '../../../i18n';
import { cn } from '../../../lib/cn';
import { SearchField } from '../../../ui/SearchField';
import { SettingsNavIcon } from './SettingsNavIcon';
import {
  matchSettingsSearchEntries,
  type SettingsSearchEntry,
} from './settingsSearchIndex';
import type { SettingsSection } from './types';

export function focusSettingsSearchTarget(target: string): void {
  const node = document.querySelector<HTMLElement>(`[data-settings-search="${target}"]`);
  if (!node) return;
  node.scrollIntoView({ block: 'center', behavior: 'smooth' });
  node.classList.add('is-settings-search-hit');
  window.setTimeout(() => node.classList.remove('is-settings-search-hit'), 1600);
}

export const SettingsCenterNav: React.FC<{
  sections: Array<{ id: SettingsSection; label: string }>;
  activeSection: SettingsSection;
  onSelectSection: (section: SettingsSection) => void;
  t: (key: TranslationKey) => string;
}> = ({ sections, activeSection, onSelectSection, t }) => {
  const [query, setQuery] = useState('');
  const navRef = useRef<HTMLDivElement>(null);
  const [horizontal, setHorizontal] = useState(() => window.matchMedia('(max-width: 960px)').matches);
  const results = useMemo(
    () => matchSettingsSearchEntries(query, t),
    [query, t],
  );

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

  const selectEntry = (entry: SettingsSearchEntry) => {
    onSelectSection(entry.section);
    window.setTimeout(() => focusSettingsSearchTarget(entry.target), 50);
    setQuery('');
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
        onClear={() => setQuery('')}
        clearLabel={t('app.clearSearch')}
      />
      {results.length > 0 ? (
        <div className="settings-search-results" role="listbox" data-testid="settings-search-results">
          {results.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className="settings-search-result"
              data-testid={`settings-search-result-${entry.id}`}
              onClick={() => selectEntry(entry)}
            >
              <span>{t(entry.titleKey)}</span>
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
        {sections.map((section) => (
          <button
            key={section.id}
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
        ))}
      </div>
    </>
  );
};
