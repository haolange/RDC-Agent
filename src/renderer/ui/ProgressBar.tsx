import { useDynStyle } from '../lib/useDynStyle';
import './ProgressBar.css';

export type ProgressBarTone = 'active' | 'done';

export interface ProgressBarProps {
  /** Items finished, clamped to `0…max`. */
  value: number;
  max: number;
  /** The accessible name. */
  label: string;
  /** How the value reads aloud, for example "3 of 10"; defaults to the numbers. */
  valueText?: string;
  /** `active` is work still running (accent); `done` counts finished work (task green). */
  tone?: ProgressBarTone;
  /** A bar with no visible text beside it takes focus and shows its label on hover. */
  standalone?: boolean;
}

/**
 * A determinate track for work whose size is known: the caller reports real counts, the bar never animates on its
 * own and never invents a fraction. A zero `max` (nothing counted yet) draws an empty track.
 */
export function ProgressBar({ value, max, label, valueText, tone = 'active', standalone = false }: ProgressBarProps) {
  const bounded = max > 0 ? Math.min(Math.max(value, 0), max) : 0;
  const fill = useDynStyle({ '--ui-progress-fill': `${max > 0 ? (bounded / max) * 100 : 0}%` });
  return (
    <span
      className={`ui-progress${tone === 'done' ? ' is-done' : ''}`}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={bounded}
      aria-valuetext={valueText}
      aria-label={label}
      {...(standalone ? { tabIndex: 0, 'data-tooltip': label } : {})}
    >
      <span className="ui-progress-fill" {...fill} />
    </span>
  );
}
