import presentation from '@shared/provider-catalog/manifests/presentation.json';
import { getProviderCategoryTranslation } from '../utils';
import type { LlmProviderEntry } from '@shared/types/settings';
import type { useI18n } from '../../../../i18n';

type Translate = ReturnType<typeof useI18n>['t'];
type DirectoryEntry = Pick<LlmProviderEntry, 'id' | 'label' | 'category' | 'endpointClass'> & {
  models: ReadonlyArray<{ id: string; label: string; aliases?: string[] }>;
};
const families = new Map(presentation.families.flatMap((family) => family.ids.map((id) => [id, family] as const)));
const aliases = new Map(Object.entries(presentation.aliases));
const brands = new Map(Object.entries(presentation.brands));
const tiers = new Map([
  ...presentation.listed.map((id) => [id, 2] as const),
  ...presentation.featured.map((id) => [id, 3] as const),
  ...presentation.recommended.map((id) => [id, 4] as const),
]);

export function providerBrand(id: string) {
  return brands.get(id) ?? families.get(id)?.brand;
}

export function isSuggestedProvider(id: string): boolean {
  return tiers.get(id) === 4;
}

export function directoryCategory(provider: Pick<DirectoryEntry, 'category' | 'endpointClass'>) {
  return provider.category === 'compatible-access' && provider.endpointClass === 'first-party'
    ? 'official-direct'
    : provider.category;
}

interface DirectoryGroup<T> {
  key: string;
  label: string;
  entries: T[];
  priority: number;
}

/** Groups only for presentation. Every action still receives the exact configured surface. */
export function directoryGroups<T extends DirectoryEntry>(
  entries: T[],
  filter: string,
  search: string,
  t: Translate,
): DirectoryGroup<T>[] {
  const terms = search.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const groups = new Map<string, DirectoryGroup<T>>();
  for (const entry of entries) {
    const category = directoryCategory(entry);
    const family = families.get(entry.id);
    const priority = tiers.get(entry.id) ?? 1;
    if (filter === 'recommended' && !terms.length && priority !== 4) continue;
    const categoryFilter = filter !== 'all' && filter !== 'recommended';
    if (categoryFilter && (filter !== category || (!terms.length && priority === 1))) continue;
    const custom = entry.endpointClass === 'user-endpoint';
    const familyLabel = custom ? t('settings.directory.custom') : family?.label;
    const keywords = [
      entry.label,
      entry.id,
      familyLabel,
      family?.aliases,
      aliases.get(entry.id),
      category,
      t(getProviderCategoryTranslation(category)),
      ...entry.models.flatMap((model) => [model.id, model.label, ...(model.aliases ?? [])]),
    ]
      .join(' ')
      .toLocaleLowerCase();
    if (!terms.every((term) => keywords.includes(term))) continue;
    const key = family?.label ?? entry.id;
    const group: DirectoryGroup<T> = groups.get(key) ?? {
      key,
      label: familyLabel ?? entry.label,
      entries: [],
      priority,
    };
    group.entries.push(entry);
    group.priority = Math.max(group.priority, priority);
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => b.priority - a.priority || a.label.localeCompare(b.label));
}
