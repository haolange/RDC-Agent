import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n';
import { useCopyDiagnostics } from '../patterns/CopyDiagnostics';
import { CopyButton } from '../ui/CopyButton';
import { Toast, ToastStack } from '../ui/Toast';
import { useNotificationStore, type Notification, type NotificationTone } from '../stores/notificationStore';

/** Errors wait for the user; everything else leaves on its own. */
const AUTO_DISMISS_MS: Record<NotificationTone, number | null> = { info: 4000, success: 4000, warning: 6000, error: null };
const VISIBLE_LIMIT = 3;

function CopyErrorDetails({ details }: { details: NonNullable<Notification['details']> }) {
  const { t } = useI18n();
  const copy = useCopyDiagnostics(details);
  return <CopyButton onCopy={copy} label={t('app.copyDetails')} copiedLabel={t('app.copied')} />;
}

export const NotificationToast: React.FC = () => {
  const { t } = useI18n();
  const notifications = useNotificationStore((state) => state.notifications);
  const remove = useNotificationStore((state) => state.remove);
  const [closing, setClosing] = useState<ReadonlySet<string>>(new Set());
  const [held, setHeld] = useState<string | null>(null);
  const timers = useRef(new Map<string, number>());

  const dismiss = useCallback((id: string) => setClosing((current) => new Set(current).add(id)), []);
  const visible = notifications.slice(0, VISIBLE_LIMIT);

  useEffect(() => {
    const active = timers.current;
    for (const notification of visible) {
      const delay = AUTO_DISMISS_MS[notification.tone];
      const running = active.has(notification.id);
      if (delay === null || closing.has(notification.id) || held === notification.id) {
        if (running) window.clearTimeout(active.get(notification.id));
        active.delete(notification.id);
        continue;
      }
      if (!running) active.set(notification.id, window.setTimeout(() => dismiss(notification.id), delay));
    }
  }, [visible, closing, held, dismiss]);

  useEffect(() => () => {
    for (const timer of timers.current.values()) window.clearTimeout(timer);
  }, []);

  return (
    <ToastStack>
      {visible.map((notification) => (
        <Toast
          key={notification.id}
          open={!closing.has(notification.id)}
          tone={notification.tone}
          title={notification.title}
          message={notification.message}
          dismissLabel={t('app.dismissNotice')}
          onDismiss={() => dismiss(notification.id)}
          onHoldChange={(isHeld) => setHeld(isHeld ? notification.id : null)}
          action={notification.details?.length ? <CopyErrorDetails details={notification.details} /> : undefined}
          onExited={() => {
            remove(notification.id);
            setClosing((current) => {
              const next = new Set(current);
              next.delete(notification.id);
              return next;
            });
          }}
        />
      ))}
    </ToastStack>
  );
};
