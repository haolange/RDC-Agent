import type { KeyboardEvent } from 'react';

/** Enter confirms an IME candidate; Shift+Enter remains a newline. */
export function shouldSendComposerOnEnter(event: Pick<KeyboardEvent, 'key' | 'shiftKey' | 'nativeEvent'>): boolean {
  return event.key === 'Enter' && !event.shiftKey
    && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229;
}
