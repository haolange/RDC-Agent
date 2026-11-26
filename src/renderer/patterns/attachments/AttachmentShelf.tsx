import { useState, type ReactNode } from 'react';
import { useI18n } from '../../i18n';
import { AttachmentTile } from './AttachmentTile';
import { AttachmentPreviewDialog, type AttachmentView } from './AttachmentPreviewDialog';
import type { AttachmentItem } from './attachmentItem';
import './attachment-shelf.css';

export function AttachmentShelf({
  items,
  className,
  testId,
  onRemove,
  children,
}: {
  items: readonly AttachmentItem[];
  className: string;
  testId: string;
  onRemove?: (id: string) => void;
  children?: ReactNode;
}) {
  const { t } = useI18n();
  const [view, setView] = useState<AttachmentView | null>(null);
  const close = () => setView((current) => current && { ...current, open: false });
  const selectImage = (item: AttachmentItem) => setView({ item, mode: 'image', open: true });
  return (
    <div className={className} data-testid={testId}>
      {children}
      {items.map((item) => (
        <AttachmentTile
          key={item.id}
          item={item}
          removeLabel={onRemove ? t('app.removeAttachment', { fileName: item.fileName }) : undefined}
          onRemove={onRemove ? () => onRemove(item.id) : undefined}
          onPreview={() => {
            if (item.mode === 'image' || item.mode === 'markdown') setView({ item, mode: item.mode, open: true });
          }}
          onNotes={() => setView({ item, mode: 'notes', open: true })}
        />
      ))}
      {view && items.some((item) => item.id === view.item.id) ? (
        <AttachmentPreviewDialog
          view={view}
          items={items}
          onSelectImage={selectImage}
          onClose={close}
          onExited={() => setView(null)}
        />
      ) : null}
    </div>
  );
}
