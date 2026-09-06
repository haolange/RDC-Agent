import React, { useCallback, useState } from 'react';
import { Toast, ToastStack } from '../../ui/Toast';
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
    <ToastStack className="notification-toast-container">
      {visible.map((n) => (
        <Toast
          key={n.id}
          className={`notification-toast notification-toast-${n.type}`}
          title={n.title}
          message={n.message}
          tone={n.type}
          onDismiss={() => {
            markRead(n.id);
            handleDismiss(n.id);
          }}
        />
      ))}
    </ToastStack>
  );
};
