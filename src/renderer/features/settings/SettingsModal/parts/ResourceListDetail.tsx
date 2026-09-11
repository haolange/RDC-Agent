import type { ReactNode } from 'react';
import { cn } from '../../../../lib/cn';
import { EmptyState } from '../../../../ui/EmptyState';

export interface ResourceListDetailProps {
  /** Scope switcher and per-scope actions. */
  toolbar: ReactNode;
  /** Rendered instead of the split view when the scope has no resources and nothing is being edited. */
  emptyTitle: string;
  emptyDescription?: ReactNode;
  emptyActions?: ReactNode;
  isEmpty: boolean;
  list?: ReactNode;
  detail?: ReactNode;
  status?: ReactNode;
  className?: string;
  testId?: string;
}

/**
 * Shared list / detail frame for scoped resource pages. An empty scope shows one
 * compact prompt at the top of the content area, never two large placeholder boxes.
 */
export function ResourceListDetail({
  toolbar,
  emptyTitle,
  emptyDescription,
  emptyActions,
  isEmpty,
  list,
  detail,
  status,
  className,
  testId,
}: ResourceListDetailProps) {
  return (
    <div className={cn('settings-resource-frame', className)} data-testid={testId}>
      <div className="settings-resource-toolbar">{toolbar}</div>
      {isEmpty ? (
        <EmptyState
          className="settings-resource-empty"
          title={emptyTitle}
          description={emptyDescription}
          actions={emptyActions}
        />
      ) : (
        <div className="settings-resource-split">
          <div className="settings-resource-list-column">{list}</div>
          <div className="settings-resource-detail-column">{detail}</div>
        </div>
      )}
      {status ? <div className="settings-resource-status" role="status">{status}</div> : null}
    </div>
  );
}
