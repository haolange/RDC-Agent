import { useState } from 'react';
import { Button } from '../../../../ui/Button';
import { Icon } from '../../../../ui/Icon';
import { IconButton } from '../../../../ui/IconButton';
import { Menu } from '../../../../ui/Menu';
import { providerIdentityDetail, resolveProviderCardStatus } from './providerCardModel';
import { ProviderMark } from './ProviderMark';
import type { LlmProviderEntry } from '@shared/types/settings';
import type { useI18n } from '../../../../i18n';

type Translate = ReturnType<typeof useI18n>['t'];

interface ProviderCardProps {
  provider: LlmProviderEntry;
  label: string;
  onDisconnect: (provider: LlmProviderEntry) => void | Promise<void>;
  onOpenConnection: (provider: LlmProviderEntry) => void;
  t: Translate;
}

export function ProviderCard({ provider, label, onDisconnect, onOpenConnection, t }: ProviderCardProps) {
  const [open, setOpen] = useState(false);
  const status = resolveProviderCardStatus(provider);
  return <article className={`settings-provider-card is-tone-${status.tone}`} data-testid={`settings-provider-card-${provider.id}`}>
    <header className="settings-provider-card-identity">
      <span className="settings-provider-emblem"><ProviderMark id={provider.id} category={provider.category} /></span>
      <div className="settings-provider-card-copy">
        <strong className="settings-provider-card-name">{label}</strong>
        <span>{providerIdentityDetail(provider, label, t)}</span>
      </div>
      <Menu open={open} onOpenChange={setOpen} align="end"
        trigger={<IconButton size="sm" label={t('settings.directory.more', { name: label })} aria-haspopup="menu"
          aria-expanded={open} data-testid={`settings-provider-actions-${provider.id}`}><Icon name="more" size={16} /></IconButton>}
        items={[{ id: 'disconnect', label: t(provider.authMode === 'account' ? 'settings.signOut' : 'settings.disconnect'),
          testId: `settings-provider-disconnect-${provider.id}`,
          onSelect: () => void onDisconnect(provider) }]} />
    </header>
    <footer className="settings-provider-card-actions">
      <span className="settings-provider-card-status"><span className="settings-provider-card-dot" />{t(status.labelKey)}</span>
      <Button size="sm" variant="secondary" data-testid={`settings-provider-connect-${provider.id}`}
        onClick={() => onOpenConnection(provider)}>{t('settings.directory.manage')}</Button>
    </footer>
  </article>;
}
