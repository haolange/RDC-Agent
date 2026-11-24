import React, { useMemo } from 'react';
import { useI18n } from '../../i18n';
import { AttachmentShelf } from '../../patterns/attachments/AttachmentShelf';
import { attachmentMode, type AttachmentItem } from '../../patterns/attachments/attachmentItem';
import { ComposerSkillChips } from './ComposerSkillChips';
import { attachmentRejectKey } from './attachmentRejectCopy';
import type { PendingAttachmentDraft } from '../../types/attachments';

export const ComposerAttachmentTray: React.FC<{
  pendingSkills: ReadonlyArray<{ id: string; name: string }>;
  pendingAttachments: PendingAttachmentDraft[];
  composerScopeKey: string;
  visionUnsupported: boolean;
  removePendingSkill: (skillId: string) => void;
  handlePendingAttachmentRemove: (attachmentId: string) => void;
  armedSkillMeta: string;
  removeArmedSkillLabel: (skillName: string) => string;
}> = ({
  pendingSkills,
  pendingAttachments,
  composerScopeKey,
  visionUnsupported,
  removePendingSkill,
  handlePendingAttachmentRemove,
  armedSkillMeta,
  removeArmedSkillLabel,
}) => {
  const { t } = useI18n();
  const items = useMemo(() => pendingAttachments.map((attachment): AttachmentItem => ({
    id: attachment.id,
    owner: attachment.error ? null : { scope: 'staging', stagingId: attachment.stagingId, composerScopeKey },
    fileName: attachment.fileName,
    mode: attachmentMode(attachment.fileName, attachment.layer),
    error: attachment.error ? t(attachmentRejectKey(attachment.error.code)) : undefined,
    warning: attachment.layer === 'image' && visionUnsupported ? t('app.attachVisionUnsupported') : undefined,
  })), [pendingAttachments, composerScopeKey, t, visionUnsupported]);
  if (items.length === 0 && pendingSkills.length === 0) return null;

  return (
    <AttachmentShelf key={composerScopeKey} items={items} className="composer-attachment-tray" testId="composer-attachments"
      onRemove={handlePendingAttachmentRemove}>
      <ComposerSkillChips
        pendingSkills={pendingSkills}
        removePendingSkill={removePendingSkill}
        armedSkillMeta={armedSkillMeta}
        removeArmedSkillLabel={removeArmedSkillLabel}
      />
    </AttachmentShelf>
  );
};
