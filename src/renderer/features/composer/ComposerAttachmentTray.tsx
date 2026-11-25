import React, { useMemo } from 'react';
import { useI18n } from '../../i18n';
import { AttachmentShelf } from '../../patterns/attachments/AttachmentShelf';
import { attachmentMode, type AttachmentItem } from '../../patterns/attachments/attachmentItem';
import { ComposerSkillChips } from './ComposerSkillChips';
import { attachmentRejectKey } from './attachmentRejectCopy';
import { useComposerView } from './ComposerControllerContext';

export const ComposerAttachmentTray: React.FC = () => {
  const { t } = useI18n();
  const { composer, scopeKey: composerScopeKey, visionSupported } = useComposerView();
  const { pendingSkills, pendingAttachments, removePendingSkill, handlePendingAttachmentRemove } = composer;
  const visionUnsupported = !visionSupported;
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
      <ComposerSkillChips pendingSkills={pendingSkills} removePendingSkill={removePendingSkill} />
    </AttachmentShelf>
  );
};
