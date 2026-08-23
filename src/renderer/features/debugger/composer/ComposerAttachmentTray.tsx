import React from 'react';
import type { PendingAttachmentDraft } from '../../../app/bootstrap/types';
import { AttachmentCard } from './AttachmentCard';
import { ComposerSkillChips } from './ComposerSkillChips';

export const ComposerAttachmentTray: React.FC<{
  pendingSkillIds: string[];
  pendingAttachments: PendingAttachmentDraft[];
  composerScopeKey: string;
  visionUnsupported: boolean;
  removePendingSkill: (skillId: string) => void;
  handlePendingAttachmentRemove: (attachmentId: string) => void;
  armedSkillMeta: string;
  removeArmedSkillLabel: (skillId: string) => string;
  removeAttachmentLabel: (fileName: string) => string;
  visionUnsupportedLabel: string;
}> = ({
  pendingSkillIds,
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
  if (pendingAttachments.length === 0 && pendingSkillIds.length === 0) return null;

  return (
    <div className="composer-attachment-tray" data-testid="composer-attachments">
      <ComposerSkillChips
        pendingSkillIds={pendingSkillIds}
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
        />
      ))}
    </div>
  );
};
