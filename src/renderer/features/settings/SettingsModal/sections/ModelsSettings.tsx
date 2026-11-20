import React from 'react';
import { ProvidersSettings } from './ProvidersSettings';
import type { LlmProviderEntry } from '@shared/types/settings';
import type { ProviderCatalogCategory } from '../types';
import type { useI18n } from '../../../../i18n';

type Translate = ReturnType<typeof useI18n>['t'];

interface ModelsSettingsProps {
  accountProviders: LlmProviderEntry[];
  providerCatalog: LlmProviderEntry[];
  providerCatalogCategories: ProviderCatalogCategory[];
  getResolvedProviderLabel: (provider: Pick<LlmProviderEntry, 'label'>) => string;
  onOpenProviderConnection: (provider: LlmProviderEntry) => void;
  selectedProviderId: string | null;
  detail: React.ReactNode;
  t: Translate;
}

export const ModelsSettings: React.FC<ModelsSettingsProps> = (props) => (
  <section className="settings-page settings-page-models" data-settings-search="models">
    <div className="settings-models-page">
      <ProvidersSettings {...props} />
    </div>
  </section>
);
