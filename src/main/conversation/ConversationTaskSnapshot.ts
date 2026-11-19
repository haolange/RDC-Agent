import type { ConversationTaskSnapshotItem } from '@shared/types/conversation';

export function normalizeTaskSnapshotItems(payload: {
  taskId?: string;
  title?: string;
  status?: string;
  statusReason?: string;
  snapshot?: ConversationTaskSnapshotItem[];
}): ConversationTaskSnapshotItem[] {
  if (Array.isArray(payload.snapshot) && payload.snapshot.length > 0) {
    return payload.snapshot.map((item, index) => ({
      taskId: item.taskId,
      title: item.title,
      status: item.status,
      statusReason: item.statusReason,
      waitingOn: item.waitingOn?.map(wait => ({ ...wait })),
      order: typeof item.order === 'number' ? item.order : index,
    }));
  }
  const taskId = payload.taskId?.trim() || 'runtime-tasks';
  return [{
    taskId,
    title: payload.title?.trim() || taskId,
    status: payload.status === 'in_progress' || payload.status === 'blocked'
      || payload.status === 'completed' || payload.status === 'cancelled' ? payload.status : 'pending',
    statusReason: payload.statusReason,
    order: 0,
  }];
}
