import { useCallback, type DragEvent, type ClipboardEvent } from 'react';
import { clipboardItemsToFiles } from './composerAttachmentIngest';

export function useComposerAttachmentDrop(options: {
  disabled: boolean;
  setIsDropActive: (active: boolean) => void;
  handleFilesIngest: (files: readonly File[]) => Promise<void>;
}) {
  const { disabled, setIsDropActive, handleFilesIngest } = options;

  const handleDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (disabled || !event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    setIsDropActive(true);
  }, [disabled, setIsDropActive]);

  const handleDragLeave = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    setIsDropActive(false);
  }, [setIsDropActive]);

  const handleDrop = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDropActive(false);
    if (disabled) return;
    const files = Array.from(event.dataTransfer.files);
    if (files.length > 0) void handleFilesIngest(files);
  }, [disabled, handleFilesIngest, setIsDropActive]);

  const handlePaste = useCallback((event: ClipboardEvent<HTMLElement>) => {
    if (disabled) return;
    const files = clipboardItemsToFiles(event.clipboardData?.items);
    if (files.length === 0) return;
    const text = event.clipboardData?.getData('text/plain') ?? '';
    if (!text.trim()) event.preventDefault();
    void handleFilesIngest(files);
  }, [disabled, handleFilesIngest]);

  return { handleDragOver, handleDragLeave, handleDrop, handlePaste };
}
