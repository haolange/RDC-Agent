import React, { type RefObject } from 'react';

export const ComposerAttachIngest: React.FC<{
  fileInputRef: RefObject<HTMLInputElement>;
  isDropActive: boolean;
  dropHint: string;
  onFiles: (files: File[]) => void;
}> = ({ fileInputRef, isDropActive, dropHint, onFiles }) => (
  <>
    <input
      ref={fileInputRef}
      type="file"
      multiple
      hidden
      data-testid="composer-attach-file-input"
      onChange={(event) => {
        const files = Array.from(event.currentTarget.files ?? []);
        event.currentTarget.value = '';
        if (files.length > 0) onFiles(files);
      }}
    />
    {isDropActive ? (
      <div className="composer-drop-overlay" data-testid="composer-drop-overlay">
        {dropHint}
      </div>
    ) : null}
  </>
);
