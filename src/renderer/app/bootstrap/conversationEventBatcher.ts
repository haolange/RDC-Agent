import type { ConversationStreamEvent } from '@shared/types/conversation';

type MessageEvent = Extract<
  ConversationStreamEvent,
  { type: 'message_patched' | 'message_completed' | 'message_errored' }
>;

export interface ConversationEventBatcherOptions {
  applyMessage: (event: MessageEvent) => void;
  schedule?: (callback: () => void) => number;
  cancel?: (handle: number) => void;
}

/**
 * Coalesce high-frequency message_patched events to one apply per animation frame.
 * Terminal events flush immediately so stop/complete never wait on RAF.
 */
export function createConversationEventBatcher(options: ConversationEventBatcherOptions) {
  const schedule = options.schedule
    ?? ((callback: () => void) => window.requestAnimationFrame(callback));
  const cancel = options.cancel
    ?? ((handle: number) => window.cancelAnimationFrame(handle));

  const pendingByMessageId = new Map<string, MessageEvent>();
  let frameHandle: number | null = null;

  const flush = () => {
    frameHandle = null;
    if (pendingByMessageId.size === 0) return;
    const batch = Array.from(pendingByMessageId.values());
    pendingByMessageId.clear();
    for (const event of batch) {
      options.applyMessage(event);
    }
  };

  const enqueuePatched = (event: Extract<ConversationStreamEvent, { type: 'message_patched' }>) => {
    pendingByMessageId.set(event.message.id, event);
    if (frameHandle == null) {
      frameHandle = schedule(flush);
    }
  };

  const flushPendingForMessage = (messageId: string) => {
    const pending = pendingByMessageId.get(messageId);
    if (!pending) return;
    pendingByMessageId.delete(messageId);
    options.applyMessage(pending);
  };

  return {
    handle(event: ConversationStreamEvent): 'batched' | 'immediate' | 'ignored' {
      if (event.type === 'message_patched') {
        enqueuePatched(event);
        return 'batched';
      }
      if (event.type === 'message_completed' || event.type === 'message_errored') {
        flushPendingForMessage(event.message.id);
        if (frameHandle != null && pendingByMessageId.size === 0) {
          cancel(frameHandle);
          frameHandle = null;
        }
        options.applyMessage(event);
        return 'immediate';
      }
      return 'ignored';
    },
    dispose() {
      if (frameHandle != null) {
        cancel(frameHandle);
        frameHandle = null;
      }
      pendingByMessageId.clear();
    },
  };
}
