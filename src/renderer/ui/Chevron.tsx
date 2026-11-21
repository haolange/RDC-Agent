import { cn } from '../lib/cn';
import { Icon, type IconSize } from './Icon';
import './Chevron.css';

export type ChevronDirection = 'down' | 'up' | 'left' | 'right';

export interface ChevronProps {
  /** Resting direction. A disclosure points right and turns down when open. */
  direction?: ChevronDirection;
  /** Disclosure state: rotates a right-pointing chevron a quarter turn so open and closed share one glyph and one motion. */
  open?: boolean;
  size?: IconSize;
  className?: string;
}

/** The single expand / navigate arrow. Direction and open state are rotations of one glyph, animated by --motion-disclosure. */
export function Chevron({ direction = 'right', open, size = 14, className }: ChevronProps) {
  return (
    <Icon
      name="chevron-right"
      size={size}
      className={cn('ui-chevron', `is-${direction}`, open && 'is-open', className)}
    />
  );
}
