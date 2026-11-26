import { useDynStyle } from './useDynStyle';

/** Stands in for the unmounted rows of a windowed list (`useWindowedList`). */
export function WindowedListSpacer({ className, height }: { className: string; height: number }) {
  const dynStyle = useDynStyle({ height: `${Math.max(0, height)}px` });
  return <li aria-hidden="true" className={className} {...dynStyle} />;
}
