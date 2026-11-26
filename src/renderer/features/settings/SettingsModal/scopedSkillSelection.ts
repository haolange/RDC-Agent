import type { SkillSelectionOption, SkillSelectionProjection } from '@shared/types/rdcRuntime';

export type SkillSelectionScope = 'user' | 'project';

export function resolveSkillSelectionRequest(scope: SkillSelectionScope, projectRoot?: string) {
  return {
    enabled: scope === 'user' || Boolean(projectRoot),
    projectRoot: scope === 'project' ? projectRoot : undefined,
  };
}

/** Metadata only: neither selecting nor displaying a skill grants execution permission. */
export function projectSkillSelection(
  catalog: SkillSelectionProjection,
  targetAgentId: string,
  selectedIds: readonly string[],
) {
  const options: SkillSelectionOption[] =
    catalog.status === 'ready'
      ? catalog.options.filter((option) => !option.unavailableToAgentIds.includes(targetAgentId))
      : [];
  const availableIds = new Set(options.map((option) => option.id));
  const knownIds = new Set(catalog.options.map((option) => option.id));
  const unavailable: Record<string, 'catalog-error' | 'target' | 'missing'> = {};
  for (const id of selectedIds) {
    if (!availableIds.has(id))
      unavailable[id] = catalog.status === 'error' ? 'catalog-error' : knownIds.has(id) ? 'target' : 'missing';
  }
  return { options, unavailable };
}
