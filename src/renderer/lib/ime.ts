import type { KeyboardEvent as ReactKeyboardEvent } from 'react';

/**
 * An input method is composing: Enter commits the candidate and Escape cancels it, so neither may also submit,
 * select or close. Chromium reports the committing keydown with `isComposing`; WebKit reports it as keyCode 229.
 */
export function isImeComposing(event: KeyboardEvent | ReactKeyboardEvent): boolean {
  const native = 'nativeEvent' in event ? event.nativeEvent : event;
  return native.isComposing || native.keyCode === 229;
}
