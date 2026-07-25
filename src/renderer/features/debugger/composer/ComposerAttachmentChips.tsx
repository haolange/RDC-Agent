import React from 'react';
import { formatBytes } from '../../../services/attachmentHelpers';
import type { PendingAttachmentDraft } from '../../../app/bootstrap/types';

export const ComposerAttachmentChips: React.FC<{
  pendingSkillIds: string[];
  pendingAttachments: PendingAttachmentDraft[];
  removePendingSkill: (skillId: string) => void;
  handlePendingAttachmentRemove: (attachmentId: string) => void;
  armedSkillMeta: string;
  removeArmedSkillLabel: (skillId: string) => string;
  removeAttachmentLabel: (fileName: string) => string;
}> = ({
  pendingSkillIds,
  pendingAttachments,
  removePendingSkill,
  handlePendingAttachmentRemove,
  armedSkillMeta,
  removeArmedSkillLabel,
  removeAttachmentLabel,
}) => {
  if (pendingAttachments.length === 0 && pendingSkillIds.length === 0) return null;

  return (
    <div className="composer-attachments" data-testid="composer-attachments">
      {pendingSkillIds.map((skillId) => (
        <div key={`skill-${skillId}`} className="composer-attachment-chip skill" data-testid="composer-skill-chip">
          <span className="composer-attachment-chip-icon" aria-hidden="true">SKL</span>
          <span className="composer-attachment-chip-copy">
            <span className="composer-attachment-chip-name">${skillId}</span>
            <span className="composer-attachment-chip-meta">{armedSkillMeta}</span>
          </span>
          <button
            type="button"
            className="composer-attachment-chip-remove"
            onClick={() => removePendingSkill(skillId)}
            aria-label={removeArmedSkillLabel(skillId)}
          >
            x
          </button>
        </div>
      ))}
      {pendingAttachments.map((attachment) => (
        <div key={attachment.id} className={`composer-attachment-chip ${attachment.kind}`}>
          <span className="composer-attachment-chip-icon" aria-hidden="true">
            {attachment.kind === 'image' ? 'IMG' : 'FILE'}
          </span>
          <span className="composer-attachment-chip-copy">
            <span className="composer-attachment-chip-name">{attachment.fileName}</span>
            <span className="composer-attachment-chip-meta">{formatBytes(attachment.size ?? 0)}</span>
          </span>
          <button
            type="button"
            className="composer-attachment-chip-remove"
            onClick={() => handlePendingAttachmentRemove(attachment.id)}
            aria-label={removeAttachmentLabel(attachment.fileName)}
          >
            x
          </button>
        </div>
      ))}
    </div>
  );
};
