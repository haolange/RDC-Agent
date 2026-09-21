import type { Dispatch, SetStateAction } from 'react';

/** Identity is per committed request lifetime, not a reusable project-path string. */
export interface OverviewProjectionLifetime { active: boolean }

export function fenceOverviewSetter<T>(lifetime: OverviewProjectionLifetime, setValue: Dispatch<SetStateAction<T>>): Dispatch<SetStateAction<T>> {
  return (update) => {
    if (!lifetime.active) return;
    setValue((previous) => {
      // React can process this update after the callback's request has been retired.
      if (!lifetime.active) return previous;
      return typeof update === 'function' ? (update as (value: T) => T)(previous) : update;
    });
  };
}
