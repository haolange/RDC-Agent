import React, { useCallback, useState } from 'react';
import { useNotificationStore } from '../../stores/notificationStore';

export const NotificationToast: React.FC = () => {
  const { notifications, markRead, remove } = useNotificationStore();
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const handleDismiss = useCallback((id: string) => {
    setDismissed((prev) => new Set(prev).add(id));
    setTimeout(() => remove(id), 300);
  }, [remove]);

  const visible = notifications.filter((n) => !n.read && !dismissed.has(n.id)).slice(0, 3);

  return (
    <div className="notification-toast-container">
      {visible.map((n) => (
        <div key={n.id} className={`notification-toast notification-toast-${n.type}`}>
          <span className="notification-toast-title">{n.title}</span>
          {n.message && <span className="notification-toast-message">{n.message}</span>}
          <button
            type="button"
            className="notification-toast-close"
            onClick={() => {
              markRead(n.id);
              handleDismiss(n.id);
            }}
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
};
