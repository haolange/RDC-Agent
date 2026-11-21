import React from 'react';
import { AttachmentCard } from './AttachmentCard';
import { ComposerSkillChips } from './ComposerSkillChips';
import type { PendingAttachmentDraft } from '../../types/attachments';

export const ComposerAttachmentTray: React.FC<{
  onMaterialChange: (id: string, material: import('@shared/types/materialContext').MaterialContext) => void;
  pendingSkills: ReadonlyArray<{ id: string; name: string }>;
  pendingAttachments: PendingAttachmentDraft[];
  composerScopeKey: string;
  visionUnsupported: boolean;
  removePendingSkill: (skillId: string) => void;
  handlePendingAttachmentRemove: (attachmentId: string) => void;
  armedSkillMeta: string;
  removeArmedSkillLabel: (skillName: string) => string;
  removeAttachmentLabel: (fileName: string) => string;
  visionUnsupportedLabel: string;
}> = ({
  onMaterialChange,
  pendingSkills,
  pendingAttachments,
  composerScopeKey,
  visionUnsupported,
  removePendingSkill,
  handlePendingAttachmentRemove,
  armedSkillMeta,
  removeArmedSkillLabel,
  removeAttachmentLabel,
  visionUnsupportedLabel,
}) => {
  if (pendingAttachments.length === 0 && pendingSkills.length === 0) return null;

  return (
    <div className="composer-attachment-tray" data-testid="composer-attachments">
      <ComposerSkillChips
        pendingSkills={pendingSkills}
        removePendingSkill={removePendingSkill}
        armedSkillMeta={armedSkillMeta}
        removeArmedSkillLabel={removeArmedSkillLabel}
      />
      {pendingAttachments.map((attachment) => (
        <AttachmentCard
          key={attachment.id}
          attachment={attachment}
          composerScopeKey={composerScopeKey}
          visionUnsupported={visionUnsupported}
          visionUnsupportedLabel={visionUnsupportedLabel}
          removeLabel={removeAttachmentLabel(attachment.fileName)}
          onRemove={handlePendingAttachmentRemove}
          onMaterialChange={onMaterialChange}
        />
      ))}
    </div>
  );
};
