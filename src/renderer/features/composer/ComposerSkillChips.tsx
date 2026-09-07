import React from 'react';

export const ComposerSkillChips: React.FC<{
  pendingSkillIds: string[];
  removePendingSkill: (skillId: string) => void;
  armedSkillMeta: string;
  removeArmedSkillLabel: (skillId: string) => string;
}> = ({
  pendingSkillIds,
  removePendingSkill,
  armedSkillMeta,
  removeArmedSkillLabel,
}) => {
  if (pendingSkillIds.length === 0) return null;
  return (
    <>
      {pendingSkillIds.map((skillId) => (
        <div key={`skill-${skillId}`} className="composer-skill-chip" data-testid="composer-skill-chip">
          <span className="composer-skill-chip-glyph" aria-hidden="true">SKL</span>
          <span className="composer-skill-chip-copy">
            <span className="composer-skill-chip-name">${skillId}</span>
            <span className="composer-skill-chip-meta">{armedSkillMeta}</span>
          </span>
          <button
            type="button"
            className="composer-skill-chip-remove"
            onClick={() => removePendingSkill(skillId)}
            aria-label={removeArmedSkillLabel(skillId)}
          >
            ×
          </button>
        </div>
      ))}
    </>
  );
};
