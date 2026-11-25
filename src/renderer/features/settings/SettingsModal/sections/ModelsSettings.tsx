import React from 'react';
import { ProvidersSettings } from './ProvidersSettings';
import type { LlmProviderEntry } from '@shared/types/settings';
import type { ProviderCatalogCategory } from '../types';

interface ModelsSettingsProps {
  accountProviders: LlmProviderEntry[];
  providerCatalog: LlmProviderEntry[];
  providerCatalogCategories: ProviderCatalogCategory[];
  getResolvedProviderLabel: (provider: Pick<LlmProviderEntry, 'label'>) => string;
  onDisconnectProvider: (provider: LlmProviderEntry) => void | Promise<void>;
  onOpenProviderConnection: (provider: LlmProviderEntry) => void;
}

export const ModelsSettings: React.FC<ModelsSettingsProps> = (props) => (
  <section className="settings-page settings-page-models" data-settings-search="models">
    <div className="settings-models-page">
      <ProvidersSettings {...props} />
    </div>
  </section>
);
