import { create } from 'zustand';
import { errorDetails, humanizeError, type ErrorDetail } from '../i18n/humanizeError';
import type { TranslationKey, Translator } from '../i18n/messages';

export type NotificationTone = 'info' | 'success' | 'warning' | 'error';

/**
 * One toast. Errors stay until dismissed and carry their technical facts only as `details`, which leave through
 * "Copy details"; the title and message are always product copy.
 */
export interface Notification {
  id: string;
  tone: NotificationTone;
  title: string;
  message?: string;
  details?: readonly ErrorDetail[];
}

interface NotificationState {
  notifications: Notification[];
  add: (notification: Omit<Notification, 'id'>) => string;
  remove: (id: string) => void;
}

let idCounter = 0;

export const useNotificationStore = create<NotificationState>((set) => ({
  notifications: [],
  add: (notification) => {
    const id = `notification-${++idCounter}`;
    set((state) => ({ notifications: [{ ...notification, id }, ...state.notifications].slice(0, 20) }));
    return id;
  },
  remove: (id) => set((state) => ({ notifications: state.notifications.filter((entry) => entry.id !== id) })),
}));

const add = (notification: Omit<Notification, 'id'>): string => useNotificationStore.getState().add(notification);

/** The one way features raise a toast. */
export const notify = {
  info: (title: string, message?: string): string => add({ tone: 'info', title, ...(message ? { message } : {}) }),
  success: (title: string, message?: string): string =>
    add({ tone: 'success', title, ...(message ? { message } : {}) }),
  warning: (title: string, message?: string): string =>
    add({ tone: 'warning', title, ...(message ? { message } : {}) }),
  error: (title: string, message?: string): string => add({ tone: 'error', title, ...(message ? { message } : {}) }),
  /**
   * A failed operation: worded by `humanizeError`, kept until dismissed, technical facts behind "Copy details"
   * (the error's own, then any `facts` the caller knows about it).
   */
  failure: (error: unknown, t: Translator, contextKey?: TranslationKey, facts: readonly ErrorDetail[] = []): string =>
    add({
      tone: 'error',
      title: humanizeError(error, t, contextKey),
      details: [...errorDetails(error), ...facts],
    }),
};
