import type { Translator, TranslationKey } from '../../i18n/messages';
import type { WorkProcessRowStatus } from './workProcessTypes';
const ROW_STATUS_KEY: Record<Exclude<WorkProcessRowStatus, 'complete'>, TranslationKey> = {
  pending: 'chat.workProcessStatusPending', running: 'chat.workProcessStatusRunning', error: 'chat.workProcessStatusError',
  skipped: 'chat.workProcessStatusSkipped', cancelled: 'chat.workProcessApprovalCancelled',
};
export const getRowStatusLabel = (status: WorkProcessRowStatus, t: Translator): string => status === 'complete' ? '' : t(ROW_STATUS_KEY[status]);
