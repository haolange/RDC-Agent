import React from 'react';
import { IconButton } from '../../ui/IconButton';
import { Icon } from '../../ui/Icon';
import { useI18n } from '../../i18n';

/** A skill armed for the next send: its icon and name; what "armed" means is on hover. */
export const ComposerSkillChips: React.FC<{
  pendingSkills: ReadonlyArray<{ id: string; name: string }>;
  removePendingSkill: (skillId: string) => void;
}> = ({ pendingSkills, removePendingSkill }) => {
  const { t } = useI18n();
  return (
    <>
      {pendingSkills.map((skill) => (
        <div key={`skill-${skill.id}`} className="composer-skill-chip" data-testid="composer-skill-chip">
          <Icon name="skill-read" size={16} className="composer-skill-chip-glyph" />
          <span className="composer-skill-chip-name" tabIndex={0} data-tooltip={t('app.armedSkillMeta')}>
            {skill.name}
          </span>
          <IconButton
            size="sm"
            className="composer-skill-chip-remove"
            onClick={() => removePendingSkill(skill.id)}
            label={t('app.removeArmedSkill', { skill: skill.name })}
          >
            <Icon name="close" size={12} />
          </IconButton>
        </div>
      ))}
    </>
  );
};
