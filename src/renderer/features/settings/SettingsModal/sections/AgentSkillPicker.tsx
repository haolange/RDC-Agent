import type { useI18n } from '../../../../i18n';
import { SearchMultiSelect } from '../../../../ui/SearchMultiSelect';
import { projectSkillSelection } from '../scopedSkillSelection';
import type { useScopedSkillSelection } from '../useScopedSkillSelection';

export type AgentSkillCatalog = ReturnType<typeof useScopedSkillSelection>;

export function AgentSkillPicker({ skills, targetAgentId, value, onChange, t }: {
  skills: AgentSkillCatalog;
  targetAgentId: string;
  value: readonly string[];
  onChange: (ids: string[]) => void;
  t: ReturnType<typeof useI18n>['t'];
}) {
  const projected = skills.catalog ? projectSkillSelection(skills.catalog, targetAgentId, value) : null;
  const unavailable = Object.fromEntries(Object.entries(projected?.unavailable ?? {}).map(([id, reason]) => [id,
    reason === 'target' ? t('settings.skillSelectionTargetUnavailable')
      : reason === 'missing' ? t('settings.skillSelectionMissing') : t('settings.skillSelectionReadFailed'),
  ]));
  return <SearchMultiSelect
    value={value} onChange={onChange}
    options={(projected?.options ?? []).map((option) => ({ id: option.id, label: option.name || option.id,
      source: option.scope === 'builtin' ? t('settings.scopeBuiltin') : option.scope === 'user' ? t('settings.scopeUser') : t('settings.scopeProject'),
    }))}
    unavailable={unavailable} loading={skills.loading} disabled={!skills.enabled}
    error={skills.error ? `${t('settings.skillSelectionReadFailed')}: ${skills.error}` : undefined}
    onRetry={skills.refresh} retryLabel={t('settings.skillSelectionRetry')}
    label={t('settings.skills')} searchLabel={t('settings.skillSelectionSearch')}
    emptyLabel={t('settings.skillSelectionEmpty')} noResultsLabel={t('settings.skillSelectionNoResults')}
    loadingLabel={t('settings.skillSelectionLoading')} unavailableLabel={t('settings.skillSelectionMissing')}
    removeLabel={(id) => t('settings.skillSelectionRemove', { id })}
  />;
}
