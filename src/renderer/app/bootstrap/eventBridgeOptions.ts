import type { ContextSnapshot } from '@shared/types/session';
import type { TranslationKey } from '../../i18n';
export interface EventBridgeOptions {
  syncCapturesFromSnapshot: (snapshot: ContextSnapshot) => void;
  showNotice: (message: string) => void;
  setSettingsModalOpen: (open: boolean) => void;
  setWindowMaximized: (maximized: boolean) => void;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
}
