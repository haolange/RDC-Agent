import { Button } from '../../../ui/Button';
import React from 'react';
import Select from '../../../ui/Select';
import { Popover } from '../../../ui/Popover';
import { SearchField } from '../../../ui/SearchField';
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
          <Select
            variant="inline"
            value={effectiveScopeFilter}
            options={scopeOptions}
            dataTestId="runtime-terminal-scope"
            onChange={(nextValue) => setScopeFilter(nextValue as TerminalScopeFilter)}
          />
        </label>

        <Popover open={filtersOpen && vm.isOpen} onOpenChange={setFiltersOpen} align="end"
          className="runtime-terminal-filter-popover" trigger={<Button variant="ghost" size="sm"
            type="button"
            className={`runtime-terminal-tool-button ${filtersOpen ? 'is-active' : ''}`}
            data-testid="runtime-terminal-filter-toggle"
          >
            {t('terminal.filters')}
          </Button>}>
              <label className="runtime-terminal-select stacked">
                <span>{t('terminal.source')}</span>
                <Select
                  variant="inline"
                  value={namespaceFilter}
                  options={namespaceOptions}
                  dataTestId="runtime-terminal-namespace"
                  onChange={(nextValue) => setNamespaceFilter(nextValue as RuntimeNamespaceFilter)}
                />
              </label>
              <label className="runtime-terminal-select stacked">
                <span>{t('terminal.level')}</span>
                <Select
                  variant="inline"
                  value={severityFilter}
                  options={severityOptions}
                  dataTestId="runtime-terminal-severity"
                  onChange={(nextValue) => setSeverityFilter(nextValue as RuntimeSeverityFilter)}
                />
              </label>
              <label className="runtime-terminal-select stacked">
                <span>{t('terminal.density')}</span>
                <Select
                  variant="inline"
                  value={density}
                  options={densityOptions}
                  dataTestId="runtime-terminal-density"
                  onChange={(nextValue) => setDensity(nextValue as TerminalDensity)}
                />
              </label>
        </Popover>

        <label className="runtime-terminal-search">
          <span className="runtime-terminal-search-label">{t('terminal.search')}</span>
          <SearchField
            aria-label={t('terminal.search')}
            value={query}
            data-testid="runtime-terminal-search"
            placeholder={t('terminal.search')}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>

        <Button variant="ghost" size="sm"
          type="button"
          className={`runtime-terminal-tool-button ${followOutput ? 'is-active' : ''}`}
          data-testid="runtime-terminal-follow"
          aria-pressed={followOutput}
          onClick={() => setFollowOutput(!followOutput)}
        >
          {t('terminal.follow')}
        </Button>
      </div>
    </div>
  );
};
