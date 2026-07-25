import { useState } from 'react';
import type { ContextSnapshot } from '@shared/types/session';
import { getElectronApi } from '../../../../platform/getElectronApi';

export function useSessionHumanPreview(input: {
  sessionContextSnapshot: ContextSnapshot | null;
  activeOpenedCaptureReplaySessionId: string | undefined;
  setContextSnapshot: (snapshot: ContextSnapshot | null) => void;
  setErrorMessage: (message: string | null) => void;
  missingContextLabel: string;
  missingSessionLabel: string;
  missingOwnerLabel: string;
}) {
  const [previewBusy, setPreviewBusy] = useState(false);
  const {
    sessionContextSnapshot,
    activeOpenedCaptureReplaySessionId,
    setContextSnapshot,
    setErrorMessage,
  } = input;

  const handleOpenHumanPreview = async () => {
    const electronAPI = getElectronApi();
    if (!electronAPI) return;
    setPreviewBusy(true);
    const result = await electronAPI.context.openHumanPreview({
      sessionId: sessionContextSnapshot?.sessionId ?? activeOpenedCaptureReplaySessionId,
    }).catch((error) => ({
      success: false,
      contextSnapshot: undefined,
      error: error instanceof Error ? error.message : String(error),
    }));
    if (result.contextSnapshot) {
      setContextSnapshot(result.contextSnapshot);
    }
    if (!result.success && result.error) {
      setErrorMessage(result.error);
    }
    setPreviewBusy(false);
  };

  const handleCloseHumanPreview = async () => {
    const electronAPI = getElectronApi();
    if (!electronAPI) return;
    setPreviewBusy(true);
    const result = await electronAPI.context.closeHumanPreview()
      .catch((error) => ({
        success: false,
        contextSnapshot: undefined,
        error: error instanceof Error ? error.message : String(error),
      }));
    if (result.contextSnapshot) {
      setContextSnapshot(result.contextSnapshot);
    }
    if (!result.success && result.error) {
      setErrorMessage(result.error);
    }
    setPreviewBusy(false);
  };

  const humanPreview = sessionContextSnapshot?.humanPreview;
  const previewSessionId = sessionContextSnapshot?.sessionId ?? activeOpenedCaptureReplaySessionId;
  const previewDisabledReason = !sessionContextSnapshot?.contextId
    ? input.missingContextLabel
    : !previewSessionId
      ? input.missingSessionLabel
      : !sessionContextSnapshot?.runtimeOwner || !sessionContextSnapshot?.ownerLeaseId
        ? input.missingOwnerLabel
        : '';
  const canControlHumanPreview = !previewDisabledReason && !previewBusy;
  const isHumanPreviewOpen = humanPreview?.status === 'open' || humanPreview?.status === 'opening';

  return {
    handleOpenHumanPreview,
    handleCloseHumanPreview,
    humanPreview,
    previewDisabledReason,
    canControlHumanPreview,
    isHumanPreviewOpen,
  };
}
