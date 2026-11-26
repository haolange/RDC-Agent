import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Button } from '../../../../ui/Button';
import { Icon } from '../../../../ui/Icon';
import { useI18n } from '../../../../i18n';
import { ProviderCard } from './ProviderCard';
import { ProviderDirectory } from './ProviderDirectory';
import { ProviderProbeBatchPanel } from './ProviderProbeBatchPanel';
import type { ProviderCatalogCategory } from '../types';
import type { LlmProviderEntry } from '@shared/types/settings';

interface ProvidersSettingsProps {
  accountProviders: LlmProviderEntry[];
  providerCatalog: LlmProviderEntry[];
  providerCatalogCategories: ProviderCatalogCategory[];
  getResolvedProviderLabel: (provider: Pick<LlmProviderEntry, 'label'>) => string;
  onDisconnectProvider: (provider: LlmProviderEntry) => void | Promise<void>;
  onOpenProviderConnection: (provider: LlmProviderEntry) => void;
}

export function ProvidersSettings({
  accountProviders,
  providerCatalog,
  providerCatalogCategories,
  getResolvedProviderLabel,
  onDisconnectProvider,
  onOpenProviderConnection,
}: ProvidersSettingsProps) {
  const { t } = useI18n();
  const [adding, setAdding] = useState(false);
  const cards = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const pendingDisconnect = useRef<{ id: string; index: number } | null>(null);
  const entries = useMemo(
    () => [...new Map([...providerCatalog, ...accountProviders].map((entry) => [entry.id, entry])).values()],
    [providerCatalog, accountProviders],
  );
  const configured = entries.filter((entry) => entry.isConfigured);
  const browse = adding || !configured.length;
  useLayoutEffect(() => {
    const pending = pendingDisconnect.current;
    if (!pending) return;
    const remaining = configured.find((provider) => provider.id === pending.id);
    if (remaining) {
      if (remaining.status === 'failed') pendingDisconnect.current = null;
      return;
    }
    pendingDisconnect.current = null;
    // A slow disconnect can finish after the user has already moved elsewhere.
    if (document.activeElement !== document.body) return;
    const buttons = cards.current?.querySelectorAll<HTMLButtonElement>('.settings-provider-card-actions button');
    const next = buttons?.[Math.min(pending.index, buttons.length - 1)];
    (next ?? search.current)?.focus();
  }, [configured]);
  return (
    <>
      <div className="settings-provider-toolbar">
        <h3 className="settings-provider-group-title">
          {t(browse ? 'settings.directory.add' : 'settings.configuredServices')}
        </h3>
        <div className="settings-provider-actions">
          {configured.length > 0 ? (
            <Button
              variant={browse ? 'secondary' : 'primary'}
              size="sm"
              aria-expanded={browse}
              data-testid="settings-provider-directory-toggle"
              onClick={() => setAdding(!adding)}
            >
              {browse ? null : <Icon name="plus" size={14} />}
              {t(browse ? 'settings.configuredServices' : 'settings.directory.add')}
            </Button>
          ) : null}
          <ProviderProbeBatchPanel />
        </div>
      </div>
      {browse ? (
        <ProviderDirectory
          searchRef={search}
          entries={entries.filter((entry) => !entry.isConfigured)}
          categories={providerCatalogCategories}
          onChoose={onOpenProviderConnection}
        />
      ) : (
        <div ref={cards} className="settings-provider-grid" data-testid="settings-configured-services">
          {configured.map((provider, index) => (
            <ProviderCard
              key={provider.id}
              provider={provider}
              label={getResolvedProviderLabel(provider)}
              onOpenConnection={onOpenProviderConnection}
              onDisconnect={(entry) => {
                pendingDisconnect.current = { id: entry.id, index };
                return onDisconnectProvider(entry);
              }}
            />
          ))}
        </div>
      )}
    </>
  );
}
