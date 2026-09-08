import React from 'react';
import DropdownSelect from '../../../ui/DropdownSelect';
import {
  type RuntimeNamespaceFilter,
  type RuntimeSeverityFilter,
  type TerminalDensity,
  type TerminalScopeFilter,
} from '../../../stores/terminalStore';
import type { TerminalDrawerViewModel } from './useTerminalDrawer';

interface TerminalDrawerToolbarProps {
  vm: TerminalDrawerViewModel;
}

export const TerminalDrawerToolbar: React.FC<TerminalDrawerToolbarProps> = ({ vm }) => {
  const {
    t,
    filterMenuRef,
    filtersOpen,
    setFiltersOpen,
    effectiveScopeFilter,
    scopeOptions,
    namespaceFilter,
    namespaceOptions,
    severityFilter,
    severityOptions,
    density,
    densityOptions,
    query,
    followOutput,
    setScopeFilter,
    setNamespaceFilter,
    setSeverityFilter,
    setDensity,
    setQuery,
    setFollowOutput,
  } = vm;

  return (
    <div className="runtime-terminal-toolbar">
      <div className="runtime-terminal-tools">
        <label className="runtime-terminal-select compact">
          <span>{t('terminal.scope')}</span>
          <DropdownSelect
            variant="inline"
            value={effectiveScopeFilter}
            options={scopeOptions}
            dataTestId="runtime-terminal-scope"
            onChange={(nextValue) => setScopeFilter(nextValue as TerminalScopeFilter)}
          />
        </label>

        <div ref={filterMenuRef} className="runtime-terminal-filter-menu">
          <button
            type="button"
            className={`runtime-terminal-tool-button ${filtersOpen ? 'is-active' : ''}`}
            data-testid="runtime-terminal-filter-toggle"
            aria-haspopup="menu"
            aria-expanded={filtersOpen}
            onClick={() => setFiltersOpen((current) => !current)}
          >
            {t('terminal.filters')}
          </button>
          {filtersOpen && (
            <div className="runtime-terminal-filter-popover" role="menu">
              <label className="runtime-terminal-select stacked">
                <span>{t('terminal.source')}</span>
                <DropdownSelect
                  variant="inline"
                  value={namespaceFilter}
                  options={namespaceOptions}
                  dataTestId="runtime-terminal-namespace"
                  onChange={(nextValue) => setNamespaceFilter(nextValue as RuntimeNamespaceFilter)}
                />
              </label>
              <label className="runtime-terminal-select stacked">
                <span>{t('terminal.level')}</span>
                <DropdownSelect
                  variant="inline"
                  value={severityFilter}
                  options={severityOptions}
                  dataTestId="runtime-terminal-severity"
                  onChange={(nextValue) => setSeverityFilter(nextValue as RuntimeSeverityFilter)}
                />
              </label>
              <label className="runtime-terminal-select stacked">
                <span>{t('terminal.density')}</span>
                <DropdownSelect
                  variant="inline"
                  value={density}
                  options={densityOptions}
                  dataTestId="runtime-terminal-density"
                  onChange={(nextValue) => setDensity(nextValue as TerminalDensity)}
                />
              </label>
            </div>
          )}
        </div>

        <label className="runtime-terminal-search">
          <span className="sr-only">{t('terminal.search')}</span>
          <input
            type="search"
            value={query}
            data-testid="runtime-terminal-search"
            placeholder={t('terminal.search')}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>

        <button
          type="button"
          className={`runtime-terminal-tool-button ${followOutput ? 'is-active' : ''}`}
          data-testid="runtime-terminal-follow"
          aria-pressed={followOutput}
          onClick={() => setFollowOutput(!followOutput)}
        >
          {t('terminal.follow')}
        </button>
      </div>
    </div>
  );
};
