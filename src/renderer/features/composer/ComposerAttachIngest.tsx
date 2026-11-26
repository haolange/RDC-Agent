import React, { type RefObject } from 'react';
import { Icon } from '../../ui/Icon';

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
    {/* The one drop feedback: always mounted so it fades both in and out. */}
    <div
      className={`composer-drop-overlay${isDropActive ? ' is-visible' : ''}`}
      data-testid="composer-drop-overlay"
      aria-hidden={!isDropActive}
    >
      <Icon name="upload" size={20} />
      <span>{dropHint}</span>
    </div>
  </>
);
