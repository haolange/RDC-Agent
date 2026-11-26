import { Icon, ICON_REGISTRY, type IconName, type IconSize } from '../../../../ui/Icon';
import { providerBrand } from './providerDirectoryModel';
import type { LlmProviderCategory } from '@shared/types/settings';

const categoryIcons: Record<LlmProviderCategory, IconName> = {
  'login-authorization': 'user',
  'official-direct': 'nav-models',
  'compatible-access': 'link',
  'coding-token-plan': 'layers',
  'cloud-platform': 'cube',
  local: 'device-desktop',
};

export function ProviderMark({
  id,
  category,
  size = 24,
}: {
  id: string;
  category?: LlmProviderCategory;
  size?: IconSize;
}) {
  const brand = providerBrand(id);
  const icon = `brand-${brand}`;
  if (brand && Object.hasOwn(ICON_REGISTRY, icon)) {
    return <Icon name={icon as IconName} size={size} className="settings-brand-mark" filled />;
  }
  return <Icon name={category ? categoryIcons[category] : 'nav-models'} size={size} />;
}
