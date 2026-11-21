import { getElectronApi } from '../platform/getElectronApi';

export function getAttachmentPreview(request: {
  previewId: string;
  sessionId?: string | null;
  composerScopeKey?: string;
}) {
  return getElectronApi()?.conversation.getAttachmentPreview({
    previewId: request.previewId,
    ...(request.sessionId ? { sessionId: request.sessionId } : {}),
    ...(request.composerScopeKey ? { composerScopeKey: request.composerScopeKey } : {}),
  });
}

export function getToolImagePreview(request: {
  sessionId: string;
  previewId: string;
}) {
  return getElectronApi()?.conversation.getToolImagePreview(request);
}

export function switchConversationBranch(request: {
  sessionId: string;
  forkId: string;
  branchId: string;
}) {
  return getElectronApi()?.conversation.switchBranch(request);
}

/** A media reference in an answer (session artifact, attachment name or project path), resolved by the main process. */
export function resolveConversationMedia(request: { sessionId: string; src: string }) {
  return getElectronApi()?.conversation.resolveMedia(request);
}
