import { create } from 'zustand';

export type NotificationTone = 'info' | 'success' | 'warning' | 'error';

/** One transient toast. Technical detail never travels here; it belongs in diagnostics and logs. */
export interface Notification {
  id: string;
  tone: NotificationTone;
  title: string;
  message?: string;
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
