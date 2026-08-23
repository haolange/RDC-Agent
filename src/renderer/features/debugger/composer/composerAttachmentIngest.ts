import type {
  ComposerAttachmentDescriptor,
  ConversationAttachmentStageItem,
} from '@shared/types/conversation';
import type { PendingAttachmentDraft } from '../../../app/bootstrap/types';

export function isBrowserAppSession(): boolean {
  return Boolean((window as Window & { __RDC_AGENT_BROWSER_APP_BRIDGE__?: true }).__RDC_AGENT_BROWSER_APP_BRIDGE__);
}

export function descriptorToDraft(descriptor: ComposerAttachmentDescriptor): PendingAttachmentDraft {
  return {
    id: descriptor.stagingId,
    stagingId: descriptor.stagingId,
    sourcePath: descriptor.sourcePath,
    fileName: descriptor.fileName,
    mimeType: descriptor.mimeType,
    size: descriptor.size,
    kind: descriptor.kind,
    layer: descriptor.layer,
    previewId: descriptor.previewId,
    error: descriptor.error,
  };
}

export async function filesToStageItems(files: readonly File[]): Promise<ConversationAttachmentStageItem[]> {
  const items: ConversationAttachmentStageItem[] = [];
  for (const file of files) {
    const desktopPath = !isBrowserAppSession()
      ? window.rdcDesktop?.getPathForFile(file) ?? null
      : null;
    if (desktopPath) {
      items.push({
        sourcePath: desktopPath,
        fileName: file.name || desktopPath.split(/[\\/]/).pop() || 'attachment.bin',
      });
      continue;
    }
    const buffer = await file.arrayBuffer();
    items.push({
      fileName: file.name || 'attachment.bin',
      mimeType: file.type || null,
      bytesBase64: bufferToBase64(buffer),
    });
  }
  return items;
}

export function clipboardItemsToFiles(items: DataTransferItemList | undefined): File[] {
  if (!items) return [];
  const files: File[] = [];
  for (const item of Array.from(items)) {
    if (item.kind !== 'file') continue;
    const file = item.getAsFile();
    if (file) files.push(file);
  }
  return files;
}

function bufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunk = 0x8000;
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
  }
  return btoa(binary);
}
