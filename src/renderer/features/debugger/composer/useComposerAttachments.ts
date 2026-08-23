import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { ConversationAttachmentStageItem } from '@shared/types/conversation';
import type { useI18n } from '../../../i18n';
import type { PendingAttachmentDraft } from '../../../app/bootstrap/types';
import type { ProjectRecord, SessionRecord } from '@shared/types/session';
import { attachmentRejectKey, COMPOSER_MAX_ATTACHMENT_COUNT, isAttachmentStageOverflow } from './attachmentRejectCopy';
import { buildComposerSessionScopeKey } from './composerSessionScope';
import { descriptorToDraft, filesToStageItems, isBrowserAppSession } from './composerAttachmentIngest';

type Translate = ReturnType<typeof useI18n>['t'];

const EMPTY_PENDING_ATTACHMENTS: PendingAttachmentDraft[] = [];

function stagingIdsOf(drafts: readonly PendingAttachmentDraft[]): string[] {
  return drafts
    .map((entry) => entry.stagingId)
    .filter((stagingId): stagingId is string => Boolean(stagingId));
}

export function useComposerAttachments(options: {
  showNotice: (message: string) => void;
  t: Translate;
  currentProject: ProjectRecord | null;
  currentSession: SessionRecord | null;
  effectiveLeftCollapsed: boolean;
  leftToggleDisabled: boolean;
  toggleLeftSidebar: () => void | Promise<void>;
}) {
  const {
    showNotice,
    t,
    currentProject,
    currentSession,
    effectiveLeftCollapsed,
    leftToggleDisabled,
    toggleLeftSidebar,
  } = options;

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDropActive, setIsDropActive] = useState(false);
  const [pendingAttachmentsByScope, setPendingAttachmentsByScope] = useState<Record<string, PendingAttachmentDraft[]>>({});
  const attachmentScopeKey = useMemo(
    () => buildComposerSessionScopeKey(currentProject?.projectId, currentSession?.sessionId),
    [currentProject?.projectId, currentSession?.sessionId],
  );
  const previousScopeRef = useRef(attachmentScopeKey);
  const pendingAttachments = useMemo(
    () => pendingAttachmentsByScope[attachmentScopeKey] ?? EMPTY_PENDING_ATTACHMENTS,
    [attachmentScopeKey, pendingAttachmentsByScope],
  );
  const setPendingAttachments: Dispatch<SetStateAction<PendingAttachmentDraft[]>> = useCallback((next) => {
    setPendingAttachmentsByScope((current) => {
      const previous = current[attachmentScopeKey] ?? [];
      const value = typeof next === 'function'
        ? (next as (prev: PendingAttachmentDraft[]) => PendingAttachmentDraft[])(previous)
        : next;
      if (value.length === 0) {
        const { [attachmentScopeKey]: _removed, ...rest } = current;
        return rest;
      }
      return { ...current, [attachmentScopeKey]: value };
    });
  }, [attachmentScopeKey]);

  useEffect(() => {
    if (previousScopeRef.current === attachmentScopeKey) return;
    const previous = previousScopeRef.current;
    previousScopeRef.current = attachmentScopeKey;
    setPendingAttachmentsByScope((current) => {
      const leftovers = current[previous] ?? [];
      const released = stagingIdsOf(leftovers);
      if (released.length > 0) {
        void window.electronAPI?.conversation.releaseAttachments({ stagingIds: released });
      }
      if (!current[previous]) return current;
      const { [previous]: _removed, ...rest } = current;
      return rest;
    });
  }, [attachmentScopeKey]);

  const requireProject = useCallback((): boolean => {
    if (currentProject) return true;
    if (effectiveLeftCollapsed && !leftToggleDisabled) {
      void toggleLeftSidebar();
    }
    showNotice(t('app.attachProjectRequired'));
    return false;
  }, [currentProject, effectiveLeftCollapsed, leftToggleDisabled, showNotice, t, toggleLeftSidebar]);

  const stageItems = useCallback(async (items: ConversationAttachmentStageItem[]) => {
    const electronAPI = window.electronAPI;
    if (!electronAPI || items.length === 0) return;
    try {
      if (items.length > COMPOSER_MAX_ATTACHMENT_COUNT) {
        throw new Error(`ATTACHMENT_LIMIT_EXCEEDED: at most ${COMPOSER_MAX_ATTACHMENT_COUNT} attachments are allowed.`);
      }
      const result = await electronAPI.conversation.stageAttachments({
        items,
        composerScopeKey: attachmentScopeKey,
      });
      const discardedIds: string[] = [];
      setPendingAttachments((current) => {
        const existing = new Set(current.map((entry) => entry.stagingId).filter(Boolean));
        const next = result.attachments.filter((descriptor) => {
          if (existing.has(descriptor.stagingId) && !descriptor.error) {
            discardedIds.push(descriptor.stagingId);
            return false;
          }
          return true;
        }).map(descriptorToDraft);
        return current.concat(next);
      });
      if (discardedIds.length > 0) {
        void electronAPI.conversation.releaseAttachments({ stagingIds: discardedIds });
      }
      const accepted = result.attachments.filter((item) => !item.error);
      const rejected = result.attachments.filter((item) => item.error);
      if (accepted.length > 0) {
        showNotice(t('app.stageFilesSuccess', { count: accepted.length }));
      }
      if (rejected.length > 0) {
        const code = rejected[0]?.error?.code;
        showNotice(code ? t(attachmentRejectKey(code)) : t('app.attachRejected'));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const overflow = isAttachmentStageOverflow(message);
      const drafts: PendingAttachmentDraft[] = items.map((item, index) => ({
        id: `error-${Date.now()}-${index}`,
        stagingId: '',
        sourcePath: '',
        fileName: 'fileName' in item && item.fileName ? item.fileName : 'attachment',
        mimeType: 'application/octet-stream',
        size: 0,
        kind: 'file',
        layer: 'binary',
        error: {
          code: overflow ? 'ATTACHMENT_LIMIT_EXCEEDED' : 'ATTACHMENT_INVALID',
          message,
        },
      }));
      setPendingAttachments((current) => current.concat(drafts));
      showNotice(t(overflow
        ? 'app.attachReject.ATTACHMENT_LIMIT_EXCEEDED'
        : 'app.attachRejected'));
    }
  }, [attachmentScopeKey, setPendingAttachments, showNotice, t]);

  const handleAttachmentSelect = useCallback(async () => {
    const electronAPI = window.electronAPI;
    if (!electronAPI || !requireProject()) return;
    if (isBrowserAppSession()) {
      fileInputRef.current?.click();
      return;
    }
    const filePaths = await electronAPI.selectFiles();
    if (!filePaths?.length) return;
    await stageItems(filePaths.map((sourcePath) => ({
      sourcePath,
      fileName: sourcePath.split(/[\\/]/).pop() || sourcePath,
    })));
  }, [requireProject, stageItems]);

  const handleFilesIngest = useCallback(async (files: readonly File[]) => {
    if (!requireProject() || files.length === 0) return;
    await stageItems(await filesToStageItems(files));
  }, [requireProject, stageItems]);

  const handlePendingAttachmentRemove = useCallback((attachmentId: string) => {
    const target = pendingAttachments.find((entry) => entry.id === attachmentId);
    setPendingAttachments((current) => current.filter((entry) => entry.id !== attachmentId));
    if (target?.stagingId && !target.error) {
      void window.electronAPI?.conversation.releaseAttachments({ stagingIds: [target.stagingId] });
    }
  }, [pendingAttachments, setPendingAttachments]);

  return {
    pendingAttachments,
    setPendingAttachments,
    fileInputRef,
    isDropActive,
    setIsDropActive,
    handleAttachmentSelect,
    handleFilesIngest,
    handlePendingAttachmentRemove,
    composerScopeKey: attachmentScopeKey,
  };
}
