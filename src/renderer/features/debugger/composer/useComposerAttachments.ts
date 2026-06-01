import { useCallback, useEffect, useState } from 'react';
import {
  inferAttachmentKind,
  inferAttachmentMimeType,
} from '../../../services/attachmentHelpers';
import type { useI18n } from '../../../i18n';
import type { PendingAttachmentDraft } from '../../../app/bootstrap/types';
import type { ProjectRecord } from '@shared/types/session';

type Translate = ReturnType<typeof useI18n>['t'];

export function useComposerAttachments(options: {
  showNotice: (message: string) => void;
  t: Translate;
  currentProject: ProjectRecord | null;
  effectiveLeftCollapsed: boolean;
  leftToggleDisabled: boolean;
  toggleLeftSidebar: () => void | Promise<void>;
}) {
  const {
    showNotice,
    t,
    currentProject,
    effectiveLeftCollapsed,
    leftToggleDisabled,
    toggleLeftSidebar,
  } = options;

  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachmentDraft[]>([]);

  useEffect(() => {
    setPendingAttachments([]);
  }, [currentProject?.projectId]);

  const handleAttachmentSelect = useCallback(async () => {
    const electronAPI = window.electronAPI;
    if (!electronAPI) {
      return;
    }

    if (!currentProject) {
      if (effectiveLeftCollapsed && !leftToggleDisabled) {
        void toggleLeftSidebar();
      }
      showNotice(t('app.attachProjectRequired'));
      return;
    }

    const filePaths = await electronAPI.selectFiles();
    if (!filePaths?.length) {
      return;
    }

    const capturePaths = filePaths.filter((filePath) => /\.rdc$/i.test(filePath));
    const regularPaths = filePaths.filter((filePath) => !/\.rdc$/i.test(filePath));

    if (capturePaths.length > 0) {
      const importResult = await electronAPI.project.inputs.importPaths(currentProject.projectId, capturePaths);
      if (!importResult.success) {
        showNotice(importResult.error || t('app.importCaptureFailed'));
      } else {
        showNotice(t('app.importCaptureSuccess', { count: capturePaths.length }));
      }
    }

    if (regularPaths.length > 0) {
      setPendingAttachments((current) => {
        const existingByPath = new Set(current.map((entry) => entry.sourcePath));
        const nextEntries = regularPaths
          .filter((filePath) => !existingByPath.has(filePath))
          .map<PendingAttachmentDraft>((filePath) => ({
            id: `draft-${filePath}-${Date.now()}`,
            sourcePath: filePath,
            fileName: filePath.split(/[\\/]/).pop() || filePath,
            mimeType: inferAttachmentMimeType(filePath),
            size: null,
            kind: inferAttachmentKind(filePath),
            isCapture: false,
          }));
        return current.concat(nextEntries);
      });
      showNotice(t('app.stageFilesSuccess', { count: regularPaths.length }));
    }
  }, [currentProject, effectiveLeftCollapsed, leftToggleDisabled, showNotice, t, toggleLeftSidebar]);

  const handlePendingAttachmentRemove = useCallback((attachmentId: string) => {
    setPendingAttachments((current) => current.filter((entry) => entry.id !== attachmentId));
  }, []);

  return {
    pendingAttachments,
    setPendingAttachments,
    handleAttachmentSelect,
    handlePendingAttachmentRemove,
  };
}
