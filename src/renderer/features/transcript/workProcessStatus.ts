import { type WorkProcessRowStatus } from './workProcessTypes';

const ROW_STATUS_LABEL: Record<WorkProcessRowStatus, string> = {
  pending: '等待中',
  running: '进行中',
  complete: '',
  error: '失败',
  skipped: '已跳过',
  cancelled: '已取消',
};

export const getRowStatusLabel = (status: WorkProcessRowStatus): string => ROW_STATUS_LABEL[status];
